import axios from 'axios';
import logger from '#lib/logger.js';

export default {
    name: 'ytmp4',
    aliases: ['ytvid'],
    category: 'downloader',
    description: 'Download video dari YouTube dalam format MP4.',
    
    async execute({ sock, m, args }) {
        const url = args[0];

        // Validasi input URL dari pengguna
        if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
            return await sock.sendMessage(m.key.remoteJid, { 
                text: 'URL YouTube-nya mana, bro? Contoh: `.ytmp4 <url>`' 
            }, { quoted: m });
        }

        // Kirim pesan awal bahwa proses sedang berjalan
        const initialMessage = await sock.sendMessage(m.key.remoteJid, { 
            text: `Sip, lagi nyari videonya... 📹` 
        }, { quoted: m });

        try {
            // Panggil API untuk mendapatkan link download video
            const apiUrl = `https://nirkyy-dev.hf.space/api/v1/allvid`;
            const response = await axios.get(apiUrl, {
                params: { "url": url },
                timeout: 180000 // Timeout 3 menit untuk proses API
            });

            const { data } = response;

            // Logika BARU untuk menangani respons API yang baru
            let downloadUrl = null;
            let videoTitle = 'video-unduhan';

            // Cek jika API sukses dan data adalah array yang berisi data
            if (data?.success && Array.isArray(data.data) && data.data.length > 0) {
                // Ambil URL dan judul dari objek pertama di dalam array
                downloadUrl = data.data[0]?.video_file_url;
                videoTitle = data.data[0]?.title || videoTitle;
            }

            // Jika setelah pengecekan URL tetap tidak ditemukan
            if (!downloadUrl) {
                logger.warn({ apiResponse: data }, 'Struktur respons API tidak dikenali atau tidak ada URL video yang ditemukan.');
                throw new Error(data.message || 'API gagal memproses link atau tidak menemukan video.');
            }

            // Edit pesan untuk memberitahu bahwa proses download video dimulai
            await sock.sendMessage(m.key.remoteJid, {
                text: `✅ Video ditemukan! Sekarang lagi proses download...\n\n*Judul:* ${videoTitle}`,
                edit: initialMessage.key
            });
            
            // Download file video dari URL yang didapat
            const videoBuffer = await axios.get(downloadUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'Referer': 'https://www.youtube.com/'
                }
            });

            // Kirim file video ke pengguna dengan caption
            await sock.sendMessage(m.key.remoteJid, { 
                video: videoBuffer.data, 
                mimetype: 'video/mp4',
                caption: `*✅ Video Berhasil Diunduh!*\n\n*Judul:* ${videoTitle}`
            }, { quoted: m });

        } catch (error) {
            // Tangani error dan catat ke log
            logger.error({ err: error, url }, 'Gagal download video YouTube');
            
            let errorMessage = error.message || 'Terjadi kesalahan tidak diketahui.';
            if (error.response) {
                errorMessage = `Server API merespons dengan error ${error.response.status}.`;
            } else if (error.request) {
                errorMessage = 'Tidak ada respons dari server API. Coba lagi nanti.';
            }

            await sock.sendMessage(m.key.remoteJid, { 
                text: `Waduh, gagal download videonya, bro.\n\n*Detail Error:* ${errorMessage}\n\nCek lagi link-nya atau coba beberapa saat lagi.`
            }, { quoted: m });
        }
    }
};
