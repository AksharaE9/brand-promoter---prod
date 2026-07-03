async function check() {
  try {
    const res = await fetch('http://localhost:4000/api/health');
    const data = await res.json();
    console.log('Server is running! Health check response:', data);
  } catch (err) {
    console.error('Server is not running on port 4000:', err.message);
  }
}
check();
