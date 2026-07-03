const baseUrl = 'http://localhost:4000/api';

async function run() {
  console.log('Testing Organization Settings directly against CockroachDB...');

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
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // 2. Fetch current org settings
    console.log('\nFetching current organization settings...');
    const getRes = await fetch(`${baseUrl}/settings/organization`, { headers });
    const getData = await getRes.json();
    console.log('GET status:', getRes.status);
    console.log('Current Name:', getData.data?.name);

    // 3. Update org settings
    const testName = 'Verified CockroachDB Corp ' + Date.now();
    console.log(`\nUpdating organization settings name to: "${testName}"...`);
    const putRes = await fetch(`${baseUrl}/settings/organization`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        name: testName,
        contactInfo: { primaryEmail: 'hr@verifiedcorp.local' }
      })
    });
    const putData = await putRes.json();
    console.log('PUT status:', putRes.status);
    console.log('Updated Name (from response):', putData.data?.name);

    // 4. Verify persistency (fetch again)
    console.log('\nVerifying persistency by fetching organization settings again...');
    const getRes2 = await fetch(`${baseUrl}/settings/organization`, { headers });
    const getData2 = await getRes2.json();
    console.log('GET 2 status:', getRes2.status);
    console.log('Persisted Name:', getData2.data?.name);

    if (getData2.data?.name === testName) {
      console.log('\n✅ SUCCESS: Organization settings successfully written to and read from CockroachDB!');
    } else {
      console.error('\n❌ FAILURE: Organization settings did not match updated value!');
    }

  } catch (err) {
    console.error('Test failed:', err.message);
  }
}

run();
