// qa/check_vercel_api_url.js
async function run() {
  const resp = await fetch('https://brand-promoter-prod.vercel.app/assets/index-BRf_5CCx.js');
  const text = await resp.text();
  console.log('Index JS length:', text.length);

  // Search for API_BASE_URL or fetch calls in api chunk
  const apiChunks = [...text.matchAll(/api-[a-zA-Z0-9_-]+\.js/g)].map(x => x[0]);
  console.log('API chunks in index:', [...new Set(apiChunks)]);

  for (const chunk of [...new Set(apiChunks)]) {
    const chunkUrl = `https://brand-promoter-prod.vercel.app/assets/${chunk}`;
    console.log('Fetching', chunkUrl);
    const cResp = await fetch(chunkUrl);
    const cText = await cResp.text();
    console.log(`Chunk ${chunk}: status=${cResp.status}, length=${cText.length}`);
    
    // Look for baseUrl or http
    const urls = [...cText.matchAll(/https?:\/\/[a-zA-Z0-9_.:-]+/g)].map(x => x[0]);
    console.log('URLs in api chunk:', [...new Set(urls)]);
  }
}

run().catch(console.error);
