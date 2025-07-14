import config from '#config';

export default {
    name: 'menu',
    description: 'Menampilkan daftar command yang tersedia.',
    // Menambahkan properti 'category' untuk konsistensi
    category: 'main', 
    execute: async ({ sock, m, commands }) => {
        // Objek untuk menampung command yang sudah dikelompokkan berdasarkan kategori
        const categorizedCommands = {};

        // Loop melalui semua command yang tersedia
        for (const command of commands.values()) {
            // Jika command tidak punya kategori, lewati saja (atau beri kategori 'lainnya')
            if (!command.category) continue;
            
            // Jika kategori belum ada di objek, buat array baru
            if (!categorizedCommands[command.category]) {
                categorizedCommands[command.category] = [];
            }
            // Masukkan nama command ke kategori yang sesuai
            categorizedCommands[command.category].push(command.name);
        }

        // Teks awal untuk menu
        let menuText = `Halo, Bro! 👋\nIni daftar command yang bisa lu pake di *${config.botName}*\n\n`;

        // Loop melalui setiap kategori yang sudah dikelompokkan
        for (const category in categorizedCommands) {
            // Tambahkan judul kategori
            menuText += `*===== [ ${category.toUpperCase()} ] =====* \n`;
            
            // Buat daftar command dalam kategori tersebut
            const commandList = categorizedCommands[category]
                .map(cmd => `• _${config.prefix}${cmd}_`)
                .join('\n');
            
            menuText += `${commandList}\n`;
            menuText += `\n`; // Penutup kategori untuk estetika
        }

        // Bagian footer menu
        // Perbaikan ada di sini: Menggunakan ``` untuk code block Markdown
        menuText += `_*Made with ♡ by Sir Ihsan*_\n©2025 *${config.botName}* All Right Reserved\n\`\`\`Customizable WhatsApp Bot\`\`\``;

        // Kirim pesan dengan teks menu yang sudah dirapikan
        await sock.sendMessage(m.key.remoteJid, { text: menuText.trim() }, { quoted: m });
    }
};


