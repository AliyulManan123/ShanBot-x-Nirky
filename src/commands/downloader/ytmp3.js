import axios from 'axios';
import logger from '#lib/logger.js';

export default {
    name: 'ytmp3',
    aliases: ['play', 'song'],
    category: 'downloader',
    description: 'Download audio dari YouTube dalam format MP3.',
    
    async execute({ sock, m, args }) {
        const url = args[0];

        // Validasi input URL dari pengguna
        if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
            return await sock.sendMessage(m.key.remoteJid, { 
                text: 'URL YouTube-nya mana, bro? Contoh: `.play https://www.youtube.com/watch?v=dQw4w9WgXcQ`' 
            }, { quoted: m });
        }

        // Kirim pesan awal bahwa proses sedang berjalan
        const initialMessage = await sock.sendMessage(m.key.remoteJid, { 
            text: 'Sip, lagi nyiapin lagunya... 🎧 Mungkin butuh beberapa saat.' 
        }, { quoted: m });

        try {
            // Panggil API untuk mendapatkan link download
            const apiUrl = `https://nirkyy-dev.hf.space/api/v1/ytmp3cc`;
            const response = await axios.get(apiUrl, {
                params: { url },
                timeout: 120000 // Timeout 2 menit
            });

            const { data } = response;

            // Cek jika API gagal atau tidak mengembalikan data yang valid
            if (!data.success || !data.downloadUrl) {
                throw new Error('API gagal memproses link atau tidak menemukan link download.');
            }

            // Edit pesan untuk memberitahu bahwa proses download audio dimulai
            await sock.sendMessage(m.key.remoteJid, {
                text: `✅ Link download didapatkan! Sekarang lagi download file audio...\n\n*Judul:* ${data.title}`,
                edit: initialMessage.key
            });
            
            // Download file audio dari URL yang didapat
            const audioBuffer = await axios.get(data.downloadUrl, {
                responseType: 'arraybuffer'
            });

            // Kirim file audio ke pengguna
            await sock.sendMessage(m.key.remoteJid, { 
                audio: audioBuffer.data, 
                mimetype: 'audio/mpeg',
                fileName: `${data.title}.mp3`
            }, { quoted: m });

        } catch (error) {
            // Tangani error dan catat ke log
            logger.error({ err: error, url }, 'Gagal download audio YouTube');
            
            // Kirim pesan error ke pengguna
            const errorMessage = error.response ? `API Error: ${error.response.data?.message || 'Server API bermasalah.'}` : error.message;
            await sock.sendMessage(m.key.remoteJid, { 
                text: `Waduh, gagal download audionya, bro.\n\n*Detail Error:* ${errorMessage}\n\nMungkin link-nya salah atau servernya lagi sibuk.`
            }, { quoted: m });
        }
    }
};
