import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import config from '#config';
import logger from '#lib/logger.js';

export default {
    name: 'backup',
    aliases: ['bu'],
    category: 'owner',
    description: 'Membuat arsip .zip dari seluruh source code dan database bot.',

    async execute({ sock, m }) {
        if (!config.ownerNumber.includes(m.sender)) {
            return await sock.sendMessage(m.key.remoteJid, { text: 'Perintah ini hanya untuk owner.' }, { quoted: m });
        }

        const initialMessage = await sock.sendMessage(m.key.remoteJid, { text: 'Memulai proses backup... Mengumpulkan file dan membuat arsip .zip. Ini mungkin memakan waktu beberapa saat.' }, { quoted: m });

        const projectRoot = process.cwd();
        const outputFileName = `backup-${Date.now()}.zip`;
        const outputFilePath = path.join(projectRoot, outputFileName);
        const output = fs.createWriteStream(outputFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        const cleanup = async () => {
            try {
                if (fs.existsSync(outputFilePath)) {
                    await fs.promises.unlink(outputFilePath);
                    logger.info(`File backup sementara telah dihapus: ${outputFileName}`);
                }
            } catch (cleanupError) {
                logger.error({ err: cleanupError }, 'Gagal menghapus file backup sementara.');
            }
        };

        output.on('close', async () => {
            try {
                logger.info(`Arsip berhasil dibuat: ${outputFileName} (${archive.pointer()} total bytes)`);
                await sock.sendMessage(m.key.remoteJid, {
                    document: { url: outputFilePath },
                    fileName: outputFileName,
                    mimetype: 'application/zip',
                    caption: '✅ Backup selesai! Ini dia file arsipnya.'
                }, { quoted: m });
            } catch (sendError) {
                logger.error({ err: sendError }, 'Gagal mengirim file backup.');
                await sock.sendMessage(m.key.remoteJid, { text: 'Gagal mengirim file backup setelah berhasil dibuat.' }, { quoted: m });
            } finally {
                await cleanup();
            }
        });

        archive.on('warning', (err) => {
            logger.warn({ err }, 'Peringatan dari proses backup');
        });

        archive.on('error', async (err) => {
            logger.error({ err }, 'Error fatal saat membuat arsip backup.');
            await sock.sendMessage(m.key.remoteJid, { text: `Gagal total membuat backup: ${err.message}`, edit: initialMessage.key });
            await cleanup();
        });

        archive.pipe(output);

        try {
            const dbName = config.databaseName || 'db.sqlite';
            archive.glob('**/*', {
                cwd: projectRoot,
                ignore: ['node_modules/**', 'baileys_session/**', outputFileName]
            });

            await archive.finalize();
        } catch (error) {
            logger.error({ err: error }, 'Error saat menambahkan file ke arsip');
            await sock.sendMessage(m.key.remoteJid, { text: `Terjadi kesalahan saat memproses file untuk di-backup.`, edit: initialMessage.key });
            await cleanup();
        }
    }
};