const express = require('express');
const router = express.Router();
const { db: firestore } = require('../../config/firebase');
const { auth, requireRoles } = require('../../middleware/auth');

// GET /api/audit-logs — with advanced filtering and pagination
router.get('/', auth, requireRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      entityType, 
      action, 
      userId, 
      startDate, 
      endDate, 
      search 
    } = req.query;

    const parsedLimit = parseInt(limit);
    const parsedPage = parseInt(page);
    const offset = (parsedPage - 1) * parsedLimit;

    let query = firestore.collection("auditLogs");

    // Basic Firestore equality filters where we can
    if (entityType) query = query.where("entityType", "==", entityType);
    if (action) query = query.where("action", "==", action);
    if (userId) query = query.where("actorUserId", "==", userId);

    const snapshot = await query.get();
    let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Fetch lookup collections to resolve names in real-time
    const [usersSnap, candsSnap, appsSnap, jobsSnap, interviewsSnap] = await Promise.all([
      firestore.collection("users").get(),
      firestore.collection("candidates").get(),
      firestore.collection("applications").get(),
      firestore.collection("jobs").get(),
      firestore.collection("interviews").get()
    ]);

    const usersMap = {};
    usersSnap.docs.forEach(d => { usersMap[d.id] = { id: d.id, ...d.data() }; });

    const candsMap = {};
    candsSnap.docs.forEach(d => { candsMap[d.id] = { id: d.id, ...d.data() }; });

    const appsMap = {};
    appsSnap.docs.forEach(d => { appsMap[d.id] = { id: d.id, ...d.data() }; });

    const jobsMap = {};
    jobsSnap.docs.forEach(d => { jobsMap[d.id] = { id: d.id, ...d.data() }; });

    const interviewsMap = {};
    interviewsSnap.docs.forEach(d => { interviewsMap[d.id] = { id: d.id, ...d.data() }; });

    // Resolve Actor Name and Entity Name details for all logs
    logs.forEach(log => {
      // Resolve Actor
      const actor = usersMap[log.actorUserId];
      if (actor) {
        log.actorName = actor.fullName || log.actorName || "System";
        log.actorEmail = actor.email || log.actorEmail || "";
      } else {
        log.actorName = log.actorName || log.actorUserId || "System";
        log.actorEmail = log.actorEmail || "";
      }

      // Resolve Entity Name
      const type = String(log.entityType || "").toUpperCase();
      const id = log.entityId;

      if (id) {
        if (type === "USER") {
          log.entityName = usersMap[id]?.fullName || log.entityName || id;
        } else if (type === "CANDIDATE") {
          log.entityName = candsMap[id]?.fullName || log.entityName || id;
        } else if (type === "APPLICATION") {
          const app = appsMap[id];
          const cand = app ? candsMap[app.candidateId] : null;
          const job = app ? jobsMap[app.jobId] : null;
          if (cand && job) {
            log.entityName = `${cand.fullName} - ${job.title}`;
          } else if (cand) {
            log.entityName = cand.fullName;
          } else if (app) {
            log.entityName = app.candidateName || log.entityName || id;
          } else {
            log.entityName = log.entityName || id;
          }
        } else if (type === "INTERVIEW") {
          const iv = interviewsMap[id];
          const app = iv ? appsMap[iv.applicationId] : null;
          const cand = app ? candsMap[app.candidateId] : (iv ? candsMap[iv.candidateId] : null);
          const roundName = iv ? (iv.round || `Round ${iv.roundNo || 1}`) : "";
          if (cand && roundName) {
            log.entityName = `Interview (${roundName}) - ${cand.fullName}`;
          } else if (cand) {
            log.entityName = `Interview - ${cand.fullName}`;
          } else if (iv) {
            log.entityName = iv.candidateName || log.entityName || id;
          } else {
            log.entityName = log.entityName || id;
          }
        } else if (type === "JOB") {
          log.entityName = jobsMap[id]?.title || log.entityName || id;
        } else {
          log.entityName = log.entityName || id;
        }
      } else {
        log.entityName = log.entityName || "N/A";
      }

      // Set log.actor object for frontend backward compatibility
      log.actor = {
        fullName: log.actorName,
        email: log.actorEmail,
        role: actor ? actor.role : "Admin"
      };
    });

    // In-memory filters (date range & search)
    if (startDate) {
      const start = new Date(startDate);
      logs = logs.filter(log => new Date(log.createdAt) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      logs = logs.filter(log => new Date(log.createdAt) <= end);
    }
    if (search) {
      const s = search.toLowerCase();
      logs = logs.filter(log => 
        (log.description || "").toLowerCase().includes(s) ||
        (log.actorName || "").toLowerCase().includes(s) ||
        (log.entityName || "").toLowerCase().includes(s) ||
        (log.action || "").toLowerCase().includes(s)
      );
    }

    // Sort newest first
    logs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Paginate in memory
    const paginated = logs.slice(offset, offset + parsedLimit);

    res.json({
      success: true,
      data: paginated,
      pagination: { 
        total: logs.length, 
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(logs.length / parsedLimit)
      }
    });
  } catch (error) {
    console.error('[Audit] Query failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/audit-logs/:id
router.get('/:id', auth, requireRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const doc = await firestore.collection("auditLogs").doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }

    const log = { id: doc.id, ...doc.data() };
    
    // Resolve actor details
    let resolvedActorName = log.actorName;
    let resolvedActorEmail = log.actorEmail || '';
    let actorRole = 'Admin';
    if (log.actorUserId) {
      const userDoc = await firestore.collection("users").doc(log.actorUserId).get();
      if (userDoc.exists) {
        const u = userDoc.data();
        resolvedActorName = u.fullName || resolvedActorName;
        resolvedActorEmail = u.email || resolvedActorEmail;
        actorRole = u.role || actorRole;
      }
    }
    log.actorName = resolvedActorName || log.actorUserId || 'System';
    log.actorEmail = resolvedActorEmail;
    log.actor = {
      fullName: log.actorName,
      email: log.actorEmail,
      role: actorRole
    };

    // Resolve entity details
    const type = String(log.entityType || "").toUpperCase();
    const id = log.entityId;
    if (id) {
      if (type === "USER") {
        const userDoc = await firestore.collection("users").doc(id).get();
        log.entityName = userDoc.exists ? userDoc.data().fullName : (log.entityName || id);
      } else if (type === "CANDIDATE") {
        const candDoc = await firestore.collection("candidates").doc(id).get();
        log.entityName = candDoc.exists ? candDoc.data().fullName : (log.entityName || id);
      } else if (type === "APPLICATION") {
        const appDoc = await firestore.collection("applications").doc(id).get();
        if (appDoc.exists) {
          const app = appDoc.data();
          const candDoc = await firestore.collection("candidates").doc(app.candidateId).get();
          const jobDoc = await firestore.collection("jobs").doc(app.jobId).get();
          const candName = candDoc.exists ? candDoc.data().fullName : '';
          const jobTitle = jobDoc.exists ? jobDoc.data().title : '';
          if (candName && jobTitle) {
            log.entityName = `${candName} - ${jobTitle}`;
          } else {
            log.entityName = candName || app.candidateName || log.entityName || id;
          }
        } else {
          log.entityName = log.entityName || id;
        }
      } else if (type === "INTERVIEW") {
        const ivDoc = await firestore.collection("interviews").doc(id).get();
        if (ivDoc.exists) {
          const iv = ivDoc.data();
          const appDoc = await firestore.collection("applications").doc(iv.applicationId).get();
          const candId = appDoc.exists ? appDoc.data().candidateId : iv.candidateId;
          const candDoc = candId ? await firestore.collection("candidates").doc(candId).get() : null;
          const candName = candDoc && candDoc.exists ? candDoc.data().fullName : '';
          const roundName = iv.round || `Round ${iv.roundNo || 1}`;
          if (candName && roundName) {
            log.entityName = `Interview (${roundName}) - ${candName}`;
          } else if (candName) {
            log.entityName = `Interview - ${candName}`;
          } else {
            log.entityName = iv.candidateName || log.entityName || id;
          }
        } else {
          log.entityName = log.entityName || id;
        }
      } else if (type === "JOB") {
        const jobDoc = await firestore.collection("jobs").doc(id).get();
        log.entityName = jobDoc.exists ? jobDoc.data().title : (log.entityName || id);
      } else {
        log.entityName = log.entityName || id;
      }
    } else {
      log.entityName = log.entityName || "N/A";
    }

    res.json({ success: true, data: log });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
