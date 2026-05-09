require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PrismaClient, UserRole } = require("@prisma/client");

const prisma = new PrismaClient();

async function upsertUserByEmail(data) {
  const existing = await prisma.user.findFirst({
    where: { email: { equals: data.email, mode: "insensitive" } },
  });

  if (!existing) {
    return prisma.user.create({ data });
  }

  return prisma.user.update({
    where: { id: existing.id },
    data: {
      fullName: data.fullName,
      phone: data.phone,
      passwordHash: data.passwordHash,
      role: data.role,
      status: data.status,
    },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash("ChangeMe@123", 12);

  const seededUsers = [
    {
      fullName: "Super Admin",
      email: "admin@ats.local",
      phone: "9999999999",
      role: UserRole.SUPER_ADMIN,
      status: "ACTIVE",
    },
    {
      fullName: "HR Recruiter",
      email: "recruiter@ats.local",
      phone: "9999999998",
      role: UserRole.RECRUITER,
      status: "ACTIVE",
    },
    {
      fullName: "Recruiter Two",
      email: "recruiter2@ats.local",
      phone: "9999999996",
      role: UserRole.RECRUITER,
      status: "ACTIVE",
    },
    {
      fullName: "Hiring Team Interviewer",
      email: "interviewer@ats.local",
      phone: "9999999997",
      role: UserRole.INTERVIEWER,
      status: "ACTIVE",
    },
    {
      fullName: "Technical Interviewer",
      email: "interviewer2@ats.local",
      phone: "9999999995",
      role: UserRole.INTERVIEWER,
      status: "ACTIVE",
    },
  ];

  let superAdmin = null;
  for (const user of seededUsers) {
    const created = await upsertUserByEmail({
      ...user,
      passwordHash,
    });
    if (created.role === UserRole.SUPER_ADMIN) {
      superAdmin = created;
    }
  }

  if (!superAdmin) {
    throw new Error("Super Admin seed failed");
  }

  const existingDefaultStages = await prisma.pipelineStage.count({
    where: { jobId: null },
  });

  if (existingDefaultStages === 0) {
    const stageNames = [
      "Added",
      "Screening",
      "Shortlisted",
      "Interview",
      "Selected",
      "Joined",
    ];

    await prisma.pipelineStage.createMany({
      data: stageNames.map((name, index) => ({
        jobId: null,
        name,
        sortOrder: index + 1,
        isTerminal: name === "Joined" || name === "Selected",
      })),
    });
  }

  await prisma.customFieldDefinition.upsert({
    where: {
      entityType_fieldKey: {
        entityType: "CANDIDATE",
        fieldKey: "college_drive",
      },
    },
    create: {
      entityType: "CANDIDATE",
      fieldKey: "college_drive",
      fieldLabel: "College Drive",
      fieldType: "text",
      isRequired: false,
    },
    update: {},
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: superAdmin.id,
      action: "SEED_BOOTSTRAP",
      entityType: "SYSTEM",
      newData: { message: "Initial ATS seed completed" },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
