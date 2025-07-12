import { promises as fs } from 'fs';
import path from 'path';
import { createWriteStream, createReadStream } from 'fs';
import config from '#config';
import logger from '#lib/logger.js';

async function getAllFiles(dirPath, arrayOfFiles = [], targetCategory = null) {
    const files = await fs.readdir(dirPath, { withFileTypes: true });
    for (const file of files) {
        const fullPath = path.join(dirPath, file.name);
        if (file.isDirectory()) {
            if (file.name !== 'node_modules' && file.name !== '.git' && file.name !== 'baileys_session') {
                if (path.basename(dirPath) === 'commands' && targetCategory && file.name !== targetCategory) {
                    continue;
                }
                await getAllFiles(fullPath, arrayOfFiles, targetCategory);
            }
        } else {
            if (file.name.endsWith('.js') || file.name.endsWith('package.json')) {
                arrayOfFiles.push(fullPath);
            }
        }
    }
    return arrayOfFiles;
}

export default {
    name: 'scmap',
    description: 'Membuat peta source code, opsional per kategori command, dan mengirimkannya. (Owner Only)',
    aliases: ['sc'],
    execute: async ({ sock, m, args }) => {
        if (!config.ownerNumber.includes(m.sender)) {
            return await sock.sendMessage(m.key.remoteJid, { text: 'Wanjay, mau ngintip source code? Cuma owner yang bisa, bro!' }, { quoted: m });
        }

        const targetCategory = args[0] || null;
        const outputFileName = `scmap_${targetCategory || 'full'}_${Date.now()}.txt`;
        const projectRoot = process.cwd();
        const outputFilePath = path.join(projectRoot, outputFileName);
        const writeStream = createWriteStream(outputFilePath);

        try {
            await sock.sendMessage(m.key.remoteJid, { text: `Sip, lagi nyiapin peta source code${targetCategory ? ' untuk kategori `' + targetCategory + '`' : ''}... Ini mungkin butuh beberapa detik.` }, { quoted: m });

            const allFiles = await getAllFiles(projectRoot, [], targetCategory);
            writeStream.write(`Source Code Map for ${path.basename(projectRoot)}${targetCategory ? ` (Category: ${targetCategory})` : ''}\nGenerated on: ${new Date().toISOString()}\n\n`);

            for (const filePath of allFiles) {
                const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
                const separator = `---${relativePath}---\n`;
                writeStream.write(separator);

                const readStream = createReadStream(filePath);
                await new Promise((resolve, reject) => {
                    readStream.pipe(writeStream, { end: false });
                    readStream.on('end', () => {
                        writeStream.write('\n\n');
                        resolve();
                    });
                    readStream.on('error', reject);
                });
            }

            await new Promise(resolve => writeStream.end(resolve));

            await sock.sendMessage(m.key.remoteJid, {
                document: { url: outputFilePath },
                fileName: `source_code_map${targetCategory ? '_' + targetCategory : ''}.txt`,
                mimetype: 'text/plain',
                caption: 'Nih bro, peta source code lu. Kalo kita mulai dari awal lagi, tinggal kirim file ini ke gue.'
            }, { quoted: m });

        } catch (error) {
            logger.error({ err: error }, "Gagal membuat scmap");
            await sock.sendMessage(m.key.remoteJid, { text: 'Waduh, gagal bikin peta source code, bro.' }, { quoted: m });
        } finally {
            if (writeStream && !writeStream.closed) {
                writeStream.end();
            }
            try {
                await fs.unlink(outputFilePath);
            } catch (unlinkError) {
                logger.warn({ err: unlinkError }, `Gagal menghapus file sementara: ${outputFilePath}`);
            }
        }
    }
};