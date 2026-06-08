const admin = require("firebase-admin");
const { initializeApp: initializeWeb } = require("firebase/app");
const { getFirestore: getWebFirestore, collection, query, where, getDocs, doc, getDoc, addDoc, updateDoc, setDoc, deleteDoc, limit, orderBy } = require("firebase/firestore");
const { getDatabase: getWebDatabase, ref, set, push, onValue } = require("firebase/database");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// ── Validate required env vars on startup ──
const REQUIRED_ENV = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_STORAGE_BUCKET',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  throw new Error(
    `[Firebase] Missing required environment variables: ${missing.join(', ')}\n` +
    `Ensure your .env file is configured correctly.`
  );
}

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.asia-southeast1.firebasedatabase.app`,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  appId: process.env.FIREBASE_APP_ID,
};

let db;
let rtdb;
let usingAdmin = false;

let serviceAccount = null;
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");
if (fs.existsSync(serviceAccountPath)) {
  serviceAccount = require(serviceAccountPath);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch (e) {}
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT.startsWith('{')) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT);
    }
  } catch (e) {}
}

// Always initialize Web App for fallback and Bridge
const webApp = initializeWeb(firebaseConfig);
const webDb = getWebFirestore(webApp);
const webRtdb = getWebDatabase(webApp);
console.log("⚠️ Bridge: Web SDK Initialized (Self-Healing Mode Active)");

const createQueryWrapper = (q, options = { offset: 0, sort: null, filters: [] }) => ({
  where: (f, o, v) => {
    const nextQ = query(q, where(f, o, v));
    return createQueryWrapper(nextQ, { ...options, filters: [...options.filters, { f, o, v }] });
  },
  orderBy: (f, d) => {
    const nextQ = query(q, orderBy(f, d));
    return createQueryWrapper(nextQ, { ...options, sort: { field: f, dir: d } });
  },
  limit: (n) => createQueryWrapper(query(q, limit(n)), options),
  offset: (n) => createQueryWrapper(q, { ...options, offset: n }),
  select: () => createQueryWrapper(q, options),
  count: () => ({
    get: async () => {
      const { getCountFromServer } = require("firebase/firestore");
      try { 
        const snapshot = await getCountFromServer(q);
        const count = snapshot.data().count;
        return { data: () => ({ count }) }; 
      }
      catch (e) {
        let fb = collection(webDb, q._query.path.segments[0]);
        options.filters.forEach(filter => { fb = query(fb, where(filter.f, filter.o, filter.v)); });
        const snapshot = await getCountFromServer(fb);
        const count = snapshot.data().count;
        return { data: () => ({ count }) };
      }
    }
  }),
  get: async () => {
    let docs = [];
    try {
      const s = await getDocs(q);
      docs = s.docs;
    } catch (e) {
      console.warn("🛡️ Bridge: Missing Index. Sorting in-memory...");
      let fb = collection(webDb, q._query.path.segments[0]); 
      options.filters.forEach(filter => { fb = query(fb, where(filter.f, filter.o, filter.v)); });
      const s = await getDocs(fb);
      docs = s.docs;
      
      if (options.sort) {
        docs.sort((a, b) => {
          const av = a.data()[options.sort.field];
          const bv = b.data()[options.sort.field];
          const res = (av < bv) ? -1 : (av > bv) ? 1 : 0;
          return options.sort.dir === 'desc' ? -res : res;
        });
      }
    }
    if (options.offset > 0) docs = docs.slice(options.offset);
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs: docs.map(d => ({ id: d.id, data: () => d.data(), ref: d.ref }))
    };
  }
});

if (serviceAccount) {
  try {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: firebaseConfig.databaseURL,
        storageBucket: firebaseConfig.storageBucket
      });
    }
    db = admin.firestore();
    rtdb = admin.database();
    usingAdmin = true;
    console.log("✅ Bridge: Admin SDK Active");
  } catch (err) {
    console.error("❌ Bridge: Admin init failed, falling back to Web SDK:", err.message);
  }
}

const sanitizeData = (data) => {
  if (!data || typeof data !== 'object') return data;
  const clean = Array.isArray(data) ? [] : {};
  Object.keys(data).forEach(key => {
    const val = data[key];
    if (val !== undefined) {
      clean[key] = (typeof val === 'object' && val !== null) ? sanitizeData(val) : val;
    }
  });
  return clean;
};

if (!usingAdmin) {
  db = {
    batch: () => {
      const { writeBatch } = require("firebase/firestore");
      const b = writeBatch(webDb);
      return {
        set: (ref, data) => b.set(ref.ref || ref, sanitizeData(data)),
        update: (ref, data) => b.update(ref.ref || ref, sanitizeData(data)),
        delete: (ref) => b.delete(ref.ref || ref),
        commit: () => b.commit()
      };
    },
    collection: (p) => ({
      ...createQueryWrapper(collection(webDb, p)),
      doc: (id) => {
        const docRef = id ? doc(webDb, p, id) : doc(collection(webDb, p));
        const actualId = id || docRef.id;
        return {
          get: async () => {
            const s = await getDoc(docRef);
            return { exists: s.exists(), id: actualId, data: () => s.data(), ref: docRef };
          },
          set: (data, opts) => setDoc(docRef, sanitizeData(data), opts),
          update: (data) => updateDoc(docRef, sanitizeData(data)),
          delete: () => deleteDoc(docRef),
          collection: (subPath) => db.collection(`${p}/${actualId}/${subPath}`),
          ref: docRef,
          id: actualId
        };
      },
      add: (data) => addDoc(collection(webDb, p), sanitizeData(data)),
      batch: () => db.batch()
    }),
    getAll: async (...docRefs) => {
      if (!docRefs || docRefs.length === 0) return [];

      const results = new Array(docRefs.length);
      const collections = {};

      docRefs.forEach((wrapper, index) => {
        const rawRef = wrapper.ref || wrapper;
        const pathSegments = rawRef.path.split('/');
        const docId = pathSegments.pop();
        const colPath = pathSegments.join('/');

        if (!collections[colPath]) {
          collections[colPath] = [];
        }
        collections[colPath].push({
          index,
          docId,
          wrapper,
          rawRef
        });
      });

      const fetchPromises = Object.entries(collections).map(async ([colPath, items]) => {
        const { documentId } = require("firebase/firestore");
        const chunks = [];
        for (let i = 0; i < items.length; i += 30) {
          chunks.push(items.slice(i, i + 30));
        }

        await Promise.all(chunks.map(async (chunk) => {
          const chunkIds = chunk.map(item => item.docId);
          const colRef = collection(webDb, colPath);
          const q = query(colRef, where(documentId(), "in", chunkIds));

          try {
            const querySnap = await getDocs(q);
            const docsMap = {};
            querySnap.docs.forEach(docSnap => {
              docsMap[docSnap.id] = docSnap;
            });

            chunk.forEach(item => {
              const docSnap = docsMap[item.docId];
              if (docSnap) {
                results[item.index] = {
                  exists: true,
                  id: item.docId,
                  data: () => docSnap.data(),
                  ref: item.rawRef
                };
              } else {
                results[item.index] = {
                  exists: false,
                  id: item.docId,
                  data: () => undefined,
                  ref: item.rawRef
                };
              }
            });
          } catch (err) {
            console.error(`[firebase-getAll] Query failed for ${colPath}:`, err.message);
            await Promise.all(chunk.map(async (item) => {
              try {
                let s;
                if (typeof item.wrapper.get === 'function') {
                  s = await item.wrapper.get();
                  results[item.index] = s;
                } else {
                  s = await getDoc(item.rawRef);
                  results[item.index] = {
                    exists: s.exists(),
                    id: item.docId,
                    data: () => s.data(),
                    ref: item.rawRef
                  };
                }
              } catch (singleErr) {
                results[item.index] = {
                  exists: false,
                  id: item.docId,
                  data: () => undefined,
                  ref: item.rawRef
                };
              }
            }));
          }
        }));
      });

      await Promise.all(fetchPromises);
      return results;
    }
  };

  rtdb = {
    ref: (p) => ({
      once: async () => new Promise(resolve => onValue(ref(webRtdb, p), (s) => resolve(s), { onlyOnce: true })),
      set: (v) => set(ref(webRtdb, p), v),
      push: () => ({ key: push(ref(webRtdb, p)).key, set: (v) => set(push(ref(webRtdb, p)), v) })
    })
  };
}

async function uploadFileToFirebase(buffer, destination, contentType) {
  console.log(`🚀 Bridge: Starting upload to ${destination} (${contentType})...`);
  
  // 1. Try Cloudinary (Primary - High Reliability)
  console.log("🛡️ Bridge: Attempting Cloudinary upload...");
  try {
    const cloudinary = require("./cloudinary");
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { 
          resource_type: "auto",
          folder: "ats-resumes",
          public_id: path.basename(destination, path.extname(destination))
        },
        (error, result) => {
          if (error) {
            console.warn("⚠️ Bridge: Cloudinary upload failed, falling back to Firebase...");
            resolve(null);
          } else {
            console.log("✅ Bridge: Cloudinary upload success:", result.secure_url);
            resolve(result.secure_url);
          }
        }
      );
      uploadStream.end(buffer);
    });
    if (result) return result;
  } catch (err) {
    console.warn("⚠️ Bridge: Cloudinary module error, falling back to Firebase...");
  }

  // 2. Try Firebase Admin SDK (Fallback 1)
  if (usingAdmin) {
    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(destination);
      await file.save(buffer, { 
        metadata: { contentType }, 
        public: true,
        resumable: false 
      });
      const url = `https://storage.googleapis.com/${bucket.name}/${destination}`;
      console.log(`✅ Bridge: Admin Storage upload success: ${url}`);
      return url;
    } catch (err) {
      console.error("❌ Bridge: Admin Storage upload failed:", err.message);
    }
  }

  // 3. Try Firebase Web SDK (Final Fallback)
  try {
    const { getAuth, signInAnonymously } = require("firebase/auth");
    const { getStorage, ref: sRef, uploadBytes, getDownloadURL } = require("firebase/storage");
    
    try {
      const auth = getAuth(webApp);
      await signInAnonymously(auth);
    } catch (authErr) {}

    const storage = getStorage(webApp);
    const buckets = [
      "ats-5acc5.firebasestorage.app",
      "ats-5acc5.appspot.com",
      "ats-5acc5.asia-southeast1.firebasestorage.app",
      "ats-5acc5"
    ];

    for (const b of buckets) {
      try {
        console.log(`⏳ Bridge: Attempting Web SDK upload to bucket: ${b}...`);
        const storageRef = sRef(storage, `gs://${b}/${destination}`);
        const uint8 = new Uint8Array(buffer);
        await uploadBytes(storageRef, uint8, { contentType });
        const url = await getDownloadURL(storageRef);
        console.log(`✅ Bridge: Web Storage upload success (${b}):`, url);
        return url;
      } catch (innerErr) {}
    }
  } catch (err) {}

  console.error("❌ Bridge: All storage providers failed.");
  return null;
}

const FieldPath = (admin && admin.firestore && admin.firestore.FieldPath) || {
  documentId: () => require("firebase/firestore").documentId()
};

module.exports = { db, rtdb, admin, uploadFileToFirebase, usingAdmin, FieldPath };
