import axios from 'axios';
import logger from '#lib/logger.js';

export default {
    name: 'fbdl',
    aliases: ['fbdownloader', 'facebook'],
    category: 'downloader',
    description: 'Download video dari Facebook (Reels, Watch, dll).',
    
    async execute({ sock, m, args }) {
        const url = args[0];

        // Validasi input URL dari pengguna
        if (!url || (!url.includes('facebook.com') && !url.includes('fb.watch'))) {
            return await sock.sendMessage(m.key.remoteJid, { 
                text: 'URL Facebook-nya mana, bro? Contoh: `.fbdl <url_video_facebook>`' 
            }, { quoted: m });
        }

        // Kirim pesan awal bahwa proses sedang berjalan
        const initialMessage = await sock.sendMessage(m.key.remoteJid, { 
            text: `Sip, lagi nyari video Facebook-nya... 📹` 
        }, { quoted: m });

        try {
            // Panggil API untuk mendapatkan link download video
            const apiUrl = `https://nirkyy-dev.hf.space/api/v1/facebook-dl`;
            const response = await axios.get(apiUrl, {
                params: { "url": url },
                timeout: 180000 // Timeout 3 menit
            });

            const { data } = response;

            // Cek jika API sukses dan memiliki link download
            if (!data.success || !data.data?.links || data.data.links.length === 0) {
                throw new Error(data.message || 'API gagal memproses link atau tidak menemukan video.');
            }

            // Cari link download yang bisa langsung diunduh (type: "direct")
            const directLinks = data.data.links.filter(link => link.type === 'direct');

            if (directLinks.length === 0) {
                throw new Error('Tidak ditemukan link download langsung dari video ini.');
            }

            // Prioritaskan kualitas HD, jika tidak ada, ambil kualitas SD
            const hdLink = directLinks.find(link => link.quality.includes('HD'));
            const downloadUrl = hdLink ? hdLink.url : directLinks[0].url; // Fallback ke link pertama jika HD tidak ada

            // Edit pesan untuk memberitahu bahwa proses download video dimulai
            await sock.sendMessage(m.key.remoteJid, {
                text: `✅ Video ditemukan! Sekarang lagi proses download...`,
                edit: initialMessage.key
            });
            
            // Download file video dari URL yang didapat
            const videoBuffer = await axios.get(downloadUrl, {
                responseType: 'arraybuffer'
            });

            // Kirim file video ke pengguna
            await sock.sendMessage(m.key.remoteJid, { 
                video: videoBuffer.data, 
                mimetype: 'video/mp4',
                caption: `*✅ Video Facebook Berhasil Diunduh!*`
            }, { quoted: m });

        } catch (error) {
            // Tangani error dan catat ke log
            logger.error({ err: error, url }, 'Gagal download video Facebook');
            
            let errorMessage = error.message || 'Terjadi kesalahan tidak diketahui.';
            if (error.response) {
                errorMessage = `Server API merespons dengan error ${error.response.status}.`;
            } else if (error.request) {
                errorMessage = 'Tidak ada respons dari server API. Coba lagi nanti.';
            }

            await sock.sendMessage(m.key.remoteJid, { 
                text: `Waduh, gagal download videonya, bro.\n\n*Detail Error:* ${errorMessage}\n\nPastikan link yang kamu kirim adalah link video publik.`
            }, { quoted: m });
        }
    }
};
