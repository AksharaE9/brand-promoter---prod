async function run() {
  const baseUrl = 'http://localhost:4000/api';
  console.log('Testing local backend API via fetch...');

  try {
    // 1. Login to get token
    console.log('Logging in...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@ats.local',
        password: 'ChangeMe@123'
      })
    });

    const loginData = await loginRes.json();
    if (!loginRes.ok) {
      throw new Error(`Login failed: ${loginData.message || loginRes.statusText}`);
    }

    const token = loginData.data.token;
    console.log('Login successful. Token obtained.');

    const headers = {
      Authorization: `Bearer ${token}`
    };

    // 2. Fetch page 1
    console.log('\nFetching page 1...');
    const page1Res = await fetch(`${baseUrl}/interviews?limit=20`, { headers });
    const page1Data = await page1Res.json();
    if (!page1Res.ok) {
      console.log('Page 1 error data:', page1Data);
    }
    console.log('Page 1 status:', page1Res.status);
    console.log('Page 1 hasMore:', page1Data.hasMore);
    console.log('Page 1 nextCursor:', page1Data.nextCursor);
    console.log('Page 1 rounds count:', page1Data.data ? page1Data.data.length : 'none');
    if (page1Data.data && page1Data.data[0]) {
      console.log('Page 1 first round candidate:', page1Data.data[0].candidate);
      console.log('Page 1 first round application:', page1Data.data[0].application);
    }

    const cursor = page1Data.nextCursor;

    if (cursor) {
      // 3. Fetch page 2
      console.log(`\nFetching page 2 with cursor ${cursor}...`);
      const page2Res = await fetch(`${baseUrl}/interviews?cursor=${cursor}&limit=20`, { headers });
      const page2Data = await page2Res.json();
      console.log('Page 2 status:', page2Res.status);
      console.log('Page 2 hasMore:', page2Data.hasMore);
      console.log('Page 2 nextCursor:', page2Data.nextCursor);
      console.log('Page 2 rounds count:', page2Data.data ? page2Data.data.length : 'none');
      if (page2Data.data && page2Data.data[0]) {
        console.log('Page 2 first round candidate:', page2Data.data[0].candidate);
        console.log('Page 2 first round application:', page2Data.data[0].application);
      }
    }

  } catch (err) {
    console.error('API test failed:', err.message);
  }
}

run();
