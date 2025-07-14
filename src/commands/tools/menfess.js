import { statements, menfessSessionCache } from '#database';
import logger from '#lib/logger.js';
import config from '#config';

export default {
    name: 'menfess',
    aliases: ['confess'],
    category: 'tools',
    description: 'Memulai sesi obrolan rahasia (menfess) dengan seseorang.',
    
    async execute({ sock, m, args }) {
        const usage = 'Format salah, bro! Gunakan: `.menfess <nomor_hp>`\n\nContoh: `.menfess 6281234567890`';
        
        const target = args[0];
        if (!target) {
            return await sock.sendMessage(m.key.remoteJid, { text: usage }, { quoted: m });
        }
        
        const senderJid = m.sender;

        // Cek apakah pengirim atau target sudah dalam sesi
        const existingSession = statements.getMenfessSession.get(senderJid) || statements.getMenfessSession.get(target.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
        if (existingSession) {
            return await sock.sendMessage(senderJid, { text: 'Kamu atau target sedang dalam sesi menfess lain. Selesaikan dulu sesi yang ada dengan `.stopmenfess`.' }, { quoted: m });
        }

        // Membersihkan dan memformat nomor telepon ke format JID WhatsApp
        let targetJid = target.replace(/[^0-9]/g, '');
        if (targetJid.startsWith('0')) {
            targetJid = '62' + targetJid.slice(1);
        }
        if (!targetJid.endsWith('@s.whatsapp.net')) {
            targetJid += '@s.whatsapp.net';
        }

        // Memeriksa apakah nomor tujuan terdaftar di WhatsApp
        const [exists] = await sock.onWhatsApp(targetJid);
        if (!exists?.exists) {
            return await sock.sendMessage(senderJid, { text: `Nomor tujuan (${target}) tidak terdaftar di WhatsApp atau tidak valid.` }, { quoted: m });
        }
        
        if (targetJid === senderJid) {
            return await sock.sendMessage(senderJid, { text: 'Ngapain ngirim pesan ke diri sendiri, bro? 😅' }, { quoted: m });
        }

        // Set waktu berakhir sesi (24 jam dari sekarang)
        const expiresAt = Date.now() + (24 * 60 * 60 * 1000);

        try {
            // Memulai sesi di database
            statements.startMenfessSession.run(senderJid, targetJid, expiresAt);
            
            // Kirim notifikasi ke kedua belah pihak
            await sock.sendMessage(senderJid, { text: `✅ Sesi menfess dengan partner rahasiamu telah dimulai!\n\nSemua pesanmu (teks, gambar, stiker, dll) sekarang akan diteruskan kepadanya. Ketik \`.stopmenfess\` untuk mengakhiri.` }, { quoted: m });
            await sock.sendMessage(targetJid, { text: `Hai! Seseorang ingin mengobrol denganmu secara anonim. 🤫\n\nBalas pesan ini untuk memulai percakapan (bisa kirim teks, gambar, stiker, dll). Sesi akan berakhir jika salah satu mengetik \`.stopmenfess\` atau setelah 24 jam.` });

        } catch (error) {
            logger.error({ err: error, sender: senderJid, target: targetJid }, 'Gagal memulai sesi menfess');
            await sock.sendMessage(senderJid, { text: `Waduh, gagal memulai sesi. Mungkin nomornya salah atau aku diblokir olehnya.` }, { quoted: m });
        }
    }
};
