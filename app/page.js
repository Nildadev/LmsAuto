export default function Home() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>LMS360 Auto Solver</h1>
      <p>Để sử dụng, vui lòng chạy lệnh sau trong terminal:</p>
      <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '8px' }}>
        npm run auto
      </pre>
      <p>Hệ thống sẽ yêu cầu nhập tài khoản và mật khẩu để bắt đầu.</p>
    </div>
  );
}
