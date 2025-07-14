import { statements, menfessSessionCache } from '#database';
import logger from '#lib/logger.js';

export default {
    name: 'stopmenfess',
    category: 'tools',
    description: 'Menghentikan sesi obrolan menfess yang sedang aktif.',
    
    async execute({ sock, m }) {
        const userJid = m.sender;
        const session = statements.getMenfessSession.get(userJid);

        if (!session) {
            return await sock.sendMessage(userJid, { text: 'Kamu tidak sedang dalam sesi menfess.' }, { quoted: m });
        }

        const partnerJid = session.user1_jid === userJid ? session.user2_jid : session.user1_jid;

        try {
            statements.endMenfessSession.run(userJid);
            menfessSessionCache.delete(userJid);
            menfessSessionCache.delete(partnerJid);

            await sock.sendMessage(userJid, { text: '✅ Kamu telah menghentikan sesi menfess.' }, { quoted: m });
            await sock.sendMessage(partnerJid, { text: '⚠️ Partner bicaramu telah menghentikan sesi menfess. Sesi telah berakhir.' });
        } catch (error) {
            logger.error({ err: error, user: userJid }, 'Gagal menghentikan sesi menfess');
            await sock.sendMessage(userJid, { text: 'Waduh, terjadi error saat mencoba menghentikan sesi.' }, { quoted: m });
        }
    }
};
