const { prompt } = require('enquirer');
const { solveLMS } = require('../lib/automation');

async function main() {
    console.clear();
    console.log('=================================================');
    console.log('   LMS360 AUTO SOLVER Made With ❤️  By Nildadev');
    console.log('=================================================');

    while (true) {
        try {
            const response = await prompt([
                {
                    type: 'input',
                    name: 'username',
                    message: '👤 Tài khoản:'
                },
                {
                    type: 'password',
                    name: 'password',
                    message: '🔑 Mật khẩu:'
                }
            ]);

            if (!response.username || !response.password) {
                console.log('❌ Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
                continue;
            }

            console.log('\n🚀 Bắt đầu quá trình tự động hóa...');
            console.log('------------------------------------');

        const interactiveConfirm = async (message) => {
            const cleanMessage = message.replace(' (y/n): ', '');
            const res = await prompt({
                type: 'confirm',
                name: 'proceed',
                message: cleanMessage
            });
            return res.proceed ? 'y' : 'n';
        };

        await solveLMS(response.username, response.password, interactiveConfirm);
        break;

    } catch (err) {
        if (!err || err === '') {
            console.log('\n🛑 Đã hủy.');
            process.exit(0);
        } else if (err.message === 'INVALID_CREDENTIALS') {
            console.log('\n❌ Tên đăng nhập hoặc mật khẩu không hợp lệ. Vui lòng thử lại!\n');

        } else {
            console.error('\n❌ LỖI NGHIÊM TRỌNG TRONG QUÁ TRÌNH CHẠY:');
            console.error(err.message || err);
            console.log('\n💡 Gợi ý: Hãy kiểm tra kết nối mạng hoặc thử chạy lại.');
            process.exit(1);
        }
    }
    }
    process.exit(0);
}

main();
