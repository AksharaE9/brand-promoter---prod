'use strict';

async function streamJsonArray(res, docs, transform) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  res.write('{"success":true,"data":[');
  
  let first = true;
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[Number(i)];
    const item = transform ? transform(doc) : doc;
    if (!first) res.write(',');
    res.write(JSON.stringify(item));
    first = false;
    
    // Yield to the event loop every 50 items to avoid blocking
    if (i % 50 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  res.end(']}');
}

async function streamPaginatedJson(res, docs, extraFields, transform) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  res.write('{"success":true,');
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) {
      res.write(`"${k}":${JSON.stringify(v)},`);
    }
  }
  res.write('"data":[');
  
  let first = true;
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[Number(i)];
    const item = transform ? transform(doc) : doc;
    if (!first) res.write(',');
    res.write(JSON.stringify(item));
    first = false;
    
    // Yield to the event loop every 50 items to avoid blocking
    if (i % 50 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  res.end(']}');
}

module.exports = { streamJsonArray, streamPaginatedJson };
