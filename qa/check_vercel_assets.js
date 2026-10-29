// qa/check_vercel_assets.js
async function run() {
  const resp = await fetch('https://brand-promoter-prod.vercel.app/assets/index-BRf_5CCx.js');
  const text = await resp.text();
  console.log('index JS length:', text.length);

  const candidateChunks = [...text.matchAll(/Candidates-[a-zA-Z0-9_-]+\.js/g)].map(x => x[0]);
  console.log('Candidates chunks referenced in Vercel index:', [...new Set(candidateChunks)]);

  for (const chunk of [...new Set(candidateChunks)]) {
    const chunkUrl = `https://brand-promoter-prod.vercel.app/assets/${chunk}`;
    console.log('Fetching', chunkUrl);
    const cResp = await fetch(chunkUrl);
    const cText = await cResp.text();
    console.log(`Chunk ${chunk}: status=${cResp.status}, length=${cText.length}`);
    console.log('Contains MatchScoreChip?', cText.includes('MatchScoreChip') || cText.includes('matchScore'));
    console.log('Contains "Akshara Enterprises"?', cText.includes('Akshara Enterprises'));
    console.log('Contains "No resume"?', cText.includes('No resume'));
    console.log('Contains "Good match"?', cText.includes('Good match'));
    console.log('Contains "JOINING:"?', cText.includes('JOINING:'));
  }
}
run().catch(console.error);
