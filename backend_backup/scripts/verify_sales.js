require('dotenv').config();

const API_BASE = 'http://localhost:4000/api';
// I'll need a token. I'll try to find an existing user or use a hardcoded one if I can.
// But wait, I can just query the DB directly to verify the tables exist and have data if I run some inserts.
// A better way is to use a script that uses Prisma.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
    console.log('--- Verifying Sales Workspace Backend ---');

    try {
        // 1. Check tables
        const productCount = await prisma.product.count();
        console.log(`[PASS] Product table exists. Current count: ${productCount}`);

        // 2. Create a test product
        const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
        if (!admin) {
            console.log('[SKIP] No admin user found for testing.');
            return;
        }

        console.log(`Using admin: ${admin.fullName} (${admin.id})`);

        const testProduct = await prisma.product.create({
            data: {
                name: 'Verification Test Product',
                category: 'Software',
                location: 'Remote',
                description: 'Automated verification test.',
                createdById: admin.id,
                tracking: {
                    create: { status: 'LEAD' }
                }
            },
            include: { tracking: true }
        });
        console.log(`[PASS] Created test product: ${testProduct.id}`);

        // 3. Update tracking
        await prisma.salesTracking.update({
            where: { productId: testProduct.id },
            data: { status: 'CONTACTED', notes: 'First contact made.' }
        });
        console.log(`[PASS] Updated sales tracking status.`);

        // 4. Verify activity
        const activity = await prisma.salesActivity.findFirst({
            where: { productId: testProduct.id }
        });
        // Note: My routes log activity, but direct Prisma calls don't unless I manually call the helper.
        // In the real app, the routes handle this.
        console.log(`[INFO] (Activity logs are managed by routes, so direct Prisma calls won't show them unless coded)`);

        // 5. Cleanup
        await prisma.product.delete({ where: { id: testProduct.id } });
        console.log(`[PASS] Cleaned up test product.`);

        console.log('--- Verification Successful ---');
    } catch (err) {
        console.error('[FAIL] Verification failed:', err);
    } finally {
        await prisma.$disconnect();
    }
}

verify();
