import axios from 'axios';
import logger from '#lib/logger.js';
import { getGameMasterResponse } from '#lib/aiHelper.js';

const SONIVA_API_URL = 'https://api.paxsenix.biz.id/ai-tools/soniva-music';
const AUTH_TOKEN = 'sk-paxsenix-ImdMKbWzB6ztCfdbLn_1bYiNONyIKs2ZS-M6nELU9mEYe_Qb';
const POLLING_INTERVAL = 15000;
const POLLING_TIMEOUT = 300000;

const ATTRIBUTE_GENERATOR_PROMPT = `ANDA ADALAH "MUSIC SOMMELIER AI". Tugas Anda adalah menganalisis prompt lagu dari pengguna dan memilih SATU mood dan SATU genre yang paling sesuai dari daftar yang Disediakan.

### ATURAN SUPER KETAT ###
1.  **PILIH DARI DAFTAR**: Anda WAJIB memilih mood dan genre HANYA dari daftar di bawah ini. JANGAN menciptakan nilai baru.
    -   **Genres Valid**: Pop, Rap, Rock, EDM, R&B, Hip-Hop, Country, Latin, Jazz, K-Pop, Classical, Reggae, Indie, House, Trance, Dance, Soul, Blues, Metal, Funk, Downtempo, Electro Pop, Electro Techno, Electronic Grunge, Celtic, Jungle, Electro-Classical, Acoustic, Dubstep, Disco, Trap, Drum'N'Bass, Salsa, Tango, Deathcore, Blues Rock.
    -   **Moods Valid**: Happy, Romantic, Uplifting, Chill, Motivational, Joyful, Melancholic, Confident, Productivity, Nostalgic, Dreamy, Depressive, Hype, Slow, Dark, Passionate, Spiritual, Whimsical, Eclectic, Emotion, Hard, Lyrical, Magical, Cinematic, Anime, Heartfelt, Cheerful, Energic, Mellow, Sensual, Tarling, Sorrowful, Pray, Upbeat.
2.  **FORMAT OUTPUT**: Balasan Anda HARUS mengikuti format ini, masing-masing di baris baru. JANGAN tambahkan teks atau penjelasan lain.
    \`[MOOD]: [pilihan_mood_anda]\`
    \`[GENRE]: [pilihan_genre_anda]\`

### CONTOH ###
[PROMPT PENGGUNA]: "lagu metal tentang pertempuran epik melawan naga"
[RESPON ANDA]:
[MOOD]: Hard
[GENRE]: Metal`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getMusicAttributes(prompt) {
    try {
        const response = await getGameMasterResponse(ATTRIBUTE_GENERATOR_PROMPT, `[PROMPT PENGGUNA]: "${prompt}"`);
        const moodMatch = response.match(/\[MOOD\]:\s*(.*)/);
        const genreMatch = response.match(/\[GENRE\]:\s*(.*)/);
        return {
            mood: moodMatch ? moodMatch[1].trim() : 'Happy',
            genre: genreMatch ? genreMatch[1].trim() : 'Pop'
        };
    } catch (error) {
        logger.error({ err: error }, 'Gagal mendapatkan atribut musik dari AI');
        return { mood: 'Happy', genre: 'Pop' };
    }
}

async function pollTask(taskUrl) {
    const startTime = Date.now();
    while (Date.now() - startTime < POLLING_TIMEOUT) {
        try {
            const { data } = await axios.get(taskUrl);
            if (data.status === 'done') return data;
            if (data.status !== 'pending') throw new Error(`Status tugas tidak valid: ${data.status}`);
            await delay(POLLING_INTERVAL);
        } catch (error) {
            throw new Error('Gagal memeriksa status tugas.');
        }
    }
    throw new Error('Batas waktu pengecekan tugas terlampaui.');
}

export default {
    name: 'soniva',
    category: 'tools',
    description: 'Membuat lagu orisinal menggunakan AI berdasarkan prompt.',
    async execute({ sock, m, args }) {
        const prompt = args.join(' ');
        if (!prompt) {
            return sock.sendMessage(m.key.remoteJid, { text: 'Berikan deskripsi lagu yang kamu inginkan. Contoh: `.soniva lagu rock tentang semangat juang`' }, { quoted: m });
        }
        
        const initialMessage = await sock.sendMessage(m.key.remoteJid, { text: 'Permintaan diterima. Meminta saran mood & genre dari Music Sommelier AI... 🤖' }, { quoted: m });
        
        try {
            const { mood, genre } = await getMusicAttributes(prompt);
            
            await sock.sendMessage(m.key.remoteJid, { text: `AI merekomendasikan genre *${genre}* dengan mood *${mood}*. Mengirim ke studio Soniva... 🎶`, edit: initialMessage.key });

            const payload = {
                useLyrics: false,
                instrumentOnly: false,
                prompt: prompt,
                title: prompt.slice(0, 30),
                mood: mood,
                genre: genre,
                vocal_gender: 'random',
                record_type: 'studio',
                lyrics: ""
            };

            const initialResponse = await axios.post(SONIVA_API_URL, payload, {
                headers: { 'Authorization': `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' }
            });

            if (!initialResponse.data.ok || !initialResponse.data.task_url) {
                throw new Error(initialResponse.data.message || 'API Soniva tidak memberikan URL tugas.');
            }
            
            await sock.sendMessage(m.key.remoteJid, { text: 'Studio AI telah menerima permintaan. Proses pembuatan lagu dimulai, ini bisa memakan waktu beberapa menit... ⏳', edit: initialMessage.key });

            const result = await pollTask(initialResponse.data.task_url);

            if (!result.songs || result.songs.length === 0) {
                throw new Error('AI gagal membuat lagu atau tidak ada hasil yang dikembalikan.');
            }

            const song = result.songs[0];
            const audioBuffer = (await axios.get(song.audio_url, { responseType: 'arraybuffer' })).data;
            
            await sock.sendMessage(m.key.remoteJid, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: `${song.title}.mp3`,
                caption: `🎧 *Lagu Selesai Dibuat!*\n\n*Judul:* ${song.title}\n*Genre:* ${genre}\n*Mood:* ${mood}`
            }, { quoted: m });

        } catch (error) {
            logger.error({ err: error, prompt }, 'Gagal membuat lagu dengan Soniva');
            let errorMessage = `Waduh, gagal membuat lagu. Terjadi kesalahan: *${error.message}*`;
            if (error.response?.status === 400 && error.response.data?.message) {
                 errorMessage = `Waduh, AI salah pilih parameter.\n*Pesan Error:* ${error.response.data.message}.\n\nCoba lagi dengan prompt yang lebih spesifik.`;
            }
            await sock.sendMessage(m.key.remoteJid, { text: errorMessage, edit: initialMessage.key });
        }
    }
};