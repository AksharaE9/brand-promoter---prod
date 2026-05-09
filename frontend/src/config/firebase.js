import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCTNbY9aRSzsEMIOWXQOEoqZP3xote1fN4",
  authDomain: "ats-5acc5.firebaseapp.com",
  databaseURL: "https://ats-5acc5-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ats-5acc5",
  storageBucket: "ats-5acc5.firebasestorage.app",
  messagingSenderId: "272298077380",
  appId: "1:272298077380:web:597e95106877a764be2d91",
  measurementId: "G-8CZWLGDG1Q"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;
const db = getFirestore(app);
const rtdb = getDatabase(app);
const auth = getAuth(app);

export { app, analytics, db, rtdb, auth };
