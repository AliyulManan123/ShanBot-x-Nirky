import { Mutex } from 'async-mutex';
import { LRUCache } from 'lru-cache';
import { exec as _exec } from 'child_process';
import { promisify, inspect } from 'util';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { loadCommands } from '#lib/commandLoader.js';
import config from '#config';
import db, { statements, getGroupSettings, getAfkUser, getUserForLimiting, removeAfkUser, removePremium } from '#database';
import logger from '#lib/logger.js';
import { groupMetadataCache } from '#connection';
import { handleAiInteraction } from '#lib/aiHelper.js';

const exec = promisify(_exec);
let commandsMap;
const userMutexes = new LRUCache({ max: 500, ttl: 1000 * 60 * 30 });
const afkNotificationCooldown = new LRUCache({ max: 1000, ttl: 1000 * 60 });

const FourteenDaysInMs = 14 * 24 * 60 * 60 * 1000;
const MAX_MESSAGE_PROCESS = 5;
const EXEC_TIMEOUT = 30000;
const LIMIT_REQUIRED_CATEGORIES = ['downloader', 'tools'];

const whatsappGroupInviteRegex = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i;

function formatDuration(ms) {
    if (ms < 0) ms = -ms;
    const time = { hari: Math.floor(ms / 86400000), jam: Math.floor(ms / 3600000) % 24, menit: Math.floor(ms / 60000) % 60, detik: Math.floor(ms / 1000) % 60 };
    return Object.entries(time).filter(val => val[1] !== 0).map(([key, val]) => `${val} ${key}`).join(', ') || 'beberapa saat';
}

async function handleAfkLogic(sock, m, text) {
    const senderAfkData = getAfkUser(m.sender);
    if (senderAfkData) {
        const afkDuration = formatDuration(Date.now() - senderAfkData.afk_since);
        const userMention = `@${m.sender.split('@')[0]}`;
        const mentionsData = statements.getAfkMentions.all(m.sender);
        const mentionJids = new Set([m.sender]);
        let summaryMessage = `*${userMention} telah kembali aktif* setelah AFK selama *${afkDuration}*.`;
        if (mentionsData.length > 0) {
            summaryMessage += `\n\nSelama kamu pergi, ada *${mentionsData.length} pesan* buat kamu:\n`;
            mentionsData.forEach(mention => {
                const mentionerTag = `@${mention.mentioner_jid.split('@')[0]}`;
                const shortText = (mention.message_text || '').slice(0, 50) + ((mention.message_text || '').length > 50 ? '...' : '');
                summaryMessage += `\n- Dari ${mentionerTag}:\n  > _"${shortText}"_`;
                mentionJids.add(mention.mentioner_jid);
            });
        }
        await sock.sendMessage(m.key.remoteJid, { text: summaryMessage, mentions: Array.from(mentionJids) });
        removeAfkUser(m.sender);
    }
    const mentionedJids = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentionedJids.length > 0 && m.key.remoteJid.endsWith('@g.us')) {
        for (const jid of mentionedJids) {
            const afkData = getAfkUser(jid);
            if (!afkData || afkData.jid === m.sender) continue;
            const cooldownKey = `${m.sender}:${afkData.jid}`;
            if (afkNotificationCooldown.has(cooldownKey)) continue;
            const afkDuration = formatDuration(Date.now() - afkData.afk_since);
            const afkMessage = `Heh, jangan ganggu @${afkData.jid.split('@')[0]}, dia lagi AFK.\n\n*Alasan:* ${afkData.reason}\n*Sejak:* ${afkDuration} yang lalu.`;
            await sock.sendMessage(m.key.remoteJid, { text: afkMessage, mentions: [afkData.jid] }, { quoted: m });
            afkNotificationCooldown.set(cooldownKey, true);
            statements.insertAfkMention.run(afkData.jid, m.sender, m.pushName || 'Seseorang', m.key.remoteJid, text, Date.now());
        }
    }
}

function canUseLimit(userJid, isSpecialGroup) {
    const user = getUserForLimiting(userJid);
    if (!user) return true;

    if (user.is_premium && user.premium_expires_at > Date.now()) {
        return true;
    }
    if (user.is_premium && user.premium_expires_at <= Date.now()) {
        removePremium(userJid);
        const freshUser = getUserForLimiting(userJid);
        return canUseLimit(freshUser.jid, isSpecialGroup);
    }

    const maxLimit = isSpecialGroup ? 20 : 10;
    return user.limit_usage < maxLimit;
}

function consumeLimit(userJid) {
    statements.updateUserLimit.run(userJid);
}

export async function initializeHandler(sock) {
    if (!commandsMap) commandsMap = await loadCommands();
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const processableMessages = messages.filter(m => !m.key.fromMe).slice(0, MAX_MESSAGE_PROCESS);
        for (const m of processableMessages) {
            (async () => {
                if (!m.message || m.message.viewOnceMessage) return;
                const isGroup = m.key.remoteJid.endsWith('@g.us');
                m.sender = isGroup ? m.key.participant : m.key.remoteJid;
                if (!m.sender) return logger.warn({ key: m.key }, "Pesan diabaikan: pengirim tidak dikenal.");
                let userMutex = userMutexes.get(m.sender);
                if (!userMutex) {
                    userMutex = new Mutex();
                    userMutexes.set(m.sender, userMutex);
                }
                await userMutex.runExclusive(async () => {
                    let text;
                    try {
                        text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '';
                        
                        await handleAfkLogic(sock, m, text);
                        
                        if (isGroup) {
                            statements.incrementMessageCount.run(m.key.remoteJid, m.sender);
                            const groupSettings = getGroupSettings(m.key.remoteJid) || {};
                            if (groupSettings?.antilink_enabled) {
                                let metadata = groupMetadataCache.get(m.key.remoteJid) || await sock.groupMetadata(m.key.remoteJid);
                                if (!groupMetadataCache.has(m.key.remoteJid)) groupMetadataCache.set(m.key.remoteJid, metadata);
                                
                                const senderInfo = metadata.participants.find(p => p.id === m.sender);
                                if (!senderInfo?.admin) {
                                    const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                                    const botIsAdmin = metadata.participants.find(p => p.id === botId)?.admin;
                                    
                                    if (botIsAdmin && whatsappGroupInviteRegex.test(text)) {
                                        await sock.sendMessage(m.key.remoteJid, { text: `🚨 Terdeteksi link grup WhatsApp!\n@${m.sender.split('@')[0]} dilarang mengirim link undangan di grup ini.`, mentions: [m.sender] });
                                        await sock.sendMessage(m.key.remoteJid, { delete: m.key });
                                        return;
                                    }
                                }
                            }
                        }
                        
                        if (config.autoRead) await sock.readMessages([m.key]);
                        if (config.ownerNumber.includes(m.sender)) {
                            if (text.startsWith('$ ')) {
                                const { stdout, stderr } = await exec(text.slice(2), { timeout: EXEC_TIMEOUT });
                                let output = stdout ? `*STDOUT:*\n${stdout}` : '';
                                if (stderr) output += `\n*STDERR:*\n${stderr}`;
                                await sock.sendMessage(m.key.remoteJid, { text: output.trim() || 'Perintah dieksekusi tanpa output.' }, { quoted: m }); return;
                            }
                            if (text.startsWith('> ') || text.startsWith('=> ')) {
                                const code = text.slice(text.startsWith('> ') ? 2 : 3);
                                const result = text.startsWith('> ') ? await (Object.getPrototypeOf(async function(){}).constructor)('sock','m','text','db')(sock,m,text,db) : eval(code);
                                if (result !== undefined) await sock.sendMessage(m.key.remoteJid, { text: inspect(result, { depth: null }) }, { quoted: m }); return;
                            }
                        }
                        if (text.startsWith(config.prefix)) {
                            const commandArgs = text.slice(config.prefix.length).trim().split(/ +/);
                            const commandName = commandArgs.shift().toLowerCase();
                            const command = commandsMap.get(commandName) || Array.from(commandsMap.values()).find(cmd => cmd.aliases?.includes(commandName));
                            
                            if (command) {
                                const requiresLimit = LIMIT_REQUIRED_CATEGORIES.includes(command.category) && !config.ownerNumber.includes(m.sender);
                                
                                if (requiresLimit) {
                                    if (!canUseLimit(m.sender, m.key.remoteJid === config.specialLimitGroup)) {
                                        const ownerContact = config.ownerNumber[0].split('@')[0];
                                        const limitMessage = ` Waduh, limit harianmu udah abis, bro! 😩\n\nTenang, ada beberapa cara buat nambah limit:\n\n1.  *Gabung Grup Spesial*\nDapetin *20 limit/hari* dengan gabung grup kami:\n${config.groupInviteLink}\n\n2.  *Jadi Pengguna Premium*\nNikmati *limit tak terbatas* cuma dengan *${config.premiumPrice}*! Hubungi owner di wa.me/${ownerContact} untuk upgrade.\n\nLimit bakal di-reset besok. Sabar ya!`;
                                        await sock.sendMessage(m.key.remoteJid, { text: limitMessage }, { quoted: m });
                                        return;
                                    }
                                }
                                
                                try {
                                    await command.execute({ sock, m, args: commandArgs, text, commands: commandsMap, commandName });
                                    if (requiresLimit) {
                                        consumeLimit(m.sender);
                                    }
                                } catch (error) {
                                    logger.error({ err: error, command: command.name, user: m.sender }, `Error saat eksekusi command.`);
                                    await sock.sendMessage(m.key.remoteJid, { text: `Waduh, ada error internal pas jalanin command \`${command.name}\`. Laporan sudah dikirim ke tim teknis.` }, { quoted: m });
                                 }
                                
                                await sock.sendPresenceUpdate('paused', m.key.remoteJid);
                                return;
                            } else if (isGroup) {
                                const listItem = statements.getGroupListItem.get(m.key.remoteJid, commandName);
                                if (listItem) {
                                    await sock.sendMessage(m.key.remoteJid, { text: listItem.list_value }, { quoted: m });
                                    return;
                                }
                            }
                        }
                        if (!isGroup) {
                            const user = statements.getUserLastInteraction.get(m.sender);
                            if (!user || (Date.now() - user.last_interaction > FourteenDaysInMs)) {
                                const ownerJid = config.ownerNumber[0]; const ownerName = config.ownerName;
                                const greetingMessage = `Halo, ${m.pushName || 'Bro'}! 👋\n\nKenalin, aku *Alicia*, asisten AI di *${config.botName}*.\nAku bisa bantu kamu banyak hal, lho! Mulai dari download video, bikin stiker, sampe ngobrol seru.\n\nKalo mau tau aku bisa apa aja, ketik aja \`${config.prefix}menu\`.\nAtau kalo mau ngobrol langsung sama aku, tinggal chat aja di sini, ga usah pake perintah apa-apa!\n\nKalo ada bug atau saran, laporin aja ke ownerku ya:\n*Nama:* \`${ownerName}\`\n*WA:* \`wa.me/${ownerJid.split('@')[0]}\`\n\nYuk, mulai ngobrol! 💅`;
                                await sock.sendMessage(m.key.remoteJid, { text: greetingMessage.trim() });
                            }
                            statements.updateUserInteraction.run(m.sender, Date.now());
                            
                            let messageForAi = m;
                            let textForAi = text;
                            const isQuotedInPrivate = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                            
                            if (isQuotedInPrivate && !m.message.imageMessage) {
                                const { quotedMessage, stanzaId, participant } = m.message.extendedTextMessage.contextInfo;
                                if (quotedMessage.imageMessage) {
                                    messageForAi = {
                                        key: {
                                            remoteJid: m.key.remoteJid,
                                            id: stanzaId,
                                            fromMe: participant === sock.user.id.split(':')[0] + '@s.whatsapp.net',
                                            participant: participant
                                        },
                                        message: quotedMessage
                                    };
                                    if (!textForAi) {
                                        textForAi = quotedMessage.imageMessage.caption || '';
                                    }
                                }
                            }
                            
                            if (!textForAi) {
                                textForAi = m.message?.imageMessage?.caption || '';
                            }

                            const hasImageForAi = messageForAi.message?.imageMessage;
                            const shouldTriggerAi = (textForAi && !textForAi.startsWith(config.prefix)) || hasImageForAi;

                            if (shouldTriggerAi) {
                                let imageBuffer = null;
                                if (hasImageForAi) {
                                    try {
                                        imageBuffer = await downloadMediaMessage(messageForAi, 'buffer', {});
                                    } catch (error) {
                                        logger.error({ err: error, user: m.sender }, 'Gagal unduh gambar di direct message');
                                        await sock.sendMessage(m.key.remoteJid, { text: 'Gagal download gambar, coba lagi deh.' }, { quoted: m });
                                        return;
                                    }
                                }
                                await handleAiInteraction({ sock, m, text: textForAi, imageBuffer });
                            }
                        }
                    } catch (error) {
                        logger.error({ err: error, from: m.sender, text }, `Error di handler utama`);
                        await sock.sendMessage(m.key.remoteJid, { text: 'Waduh, ada error nih pas jalanin perintah.' }, { quoted: m });
                    }
                }).catch(err => logger.warn({ err, user: m.sender }, "User mutex error."));
            })().catch(err => logger.error({ err, msg: m.key }, "Gagal proses pesan individual."));
        }
    });
    sock.ev.on('group-participants.update', async (event) => {
        const { id, participants, action } = event;
        if (action !== 'add' || participants.length === 0) return;
        try {
            const groupSettings = getGroupSettings(id) || {};
            if (!groupSettings?.welcome_enabled) return;
            let metadata = groupMetadataCache.get(id) || await sock.groupMetadata(id);
            if (!groupMetadataCache.has(id)) groupMetadataCache.set(id, metadata);
            if (!metadata) return;
            const mentions = participants.map(jid => `@${jid.split('@')[0]}`).join(' ');
            const welcomeMessage = (groupSettings.welcome_message || '').replace(/@user/g, mentions).replace(/@subject/g, metadata.subject);
            await sock.sendMessage(id, { text: welcomeMessage, mentions: participants });
        } catch (error) {
            logger.error({ err: error, group: id }, `Error di event welcome.`);
        }
    });
}