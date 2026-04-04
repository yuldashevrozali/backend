// Test #12 natijalarini ko'rish uchun script
// Ishlatish: npx tsx scripts/view-results.ts

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const testCode = 12;

  console.log(`\n📊 Test #${testCode} natijalari:\n`);

  // Test ma'lumotlari
  const test = await prisma.test.findUnique({ where: { testCode } });
  if (!test) {
    console.log('❌ Test topilmadi!');
    return;
  }
  console.log(`📝 Test: ${test.title}`);
  console.log(`📅 Yaratilgan: ${test.createdAt.toLocaleDateString('uz-UZ')}`);
  console.log(`📌 Status: ${test.status}\n`);

  // Ishtirokchilar soni
  const participantCount = await prisma.testResult.count({ where: { testCode } });
  console.log(`👥 Ishtirokchilar: ${participantCount} ta\n`);

  // Barcha natijalar
  const results = await prisma.testResult.findMany({
    where: { testCode },
    orderBy: { scaledScore: 'desc' }
  });

  // User ma'lumotlarini olish
  const telegramIds = results.map(r => r.telegramId);
  const users = await prisma.user.findMany({
    where: { telegramId: { in: telegramIds } }
  });
  const userMap: Record<string, { name: string; surname: string }> = {};
  for (const u of users) {
    userMap[u.telegramId] = { name: u.name, surname: u.surname };
  }

  // Savollarni olish
  const questions = await prisma.question.findMany({ where: { testCode } });
  const questionMap: Record<string, string> = {};
  for (const q of questions) {
    const key = q.part ? `${q.num}.${q.part}` : String(q.num);
    questionMap[key] = q.correctAnswer;
  }

  console.log('🏆 Natijalar:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const user = userMap[r.telegramId];
    const name = user ? `${user.name} ${user.surname}` : 'Noma\'lum';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';

    console.log(`${medal} ${i + 1}. ${name}`);
    console.log(`   📈 Ball: ${r.scaledScore} | Foiz: ${r.percentage}%`);
    console.log(`   🏅 Daraja: ${r.grade} | ${r.isCertified ? '✅ Sertifikat' : '❌ Sertifikat yo\'q'}`);
    console.log(`   🧠 Theta: ${r.theta}`);
    console.log(`   ✅ To'g'ri: ${r.score}/${r.total}`);

    // Javoblarni tahlil qilish
    const answers = r.answers as Record<string, string>;
    let correctDetails = 0;
    let wrongDetails = 0;
    for (const [key, userAnswer] of Object.entries(answers)) {
      if (questionMap[key]) {
        if (userAnswer.toUpperCase() === questionMap[key].toUpperCase()) {
          correctDetails++;
        } else {
          wrongDetails++;
        }
      }
    }
    console.log(`   📊 Batafsil: ${correctDetails} to'g'ri, ${wrongDetails} noto'g'ri`);

    if (i < results.length - 1) {
      console.log('──────────────────────────────────────────────');
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n✅ Test yakunlangan: ${test.status === 'finished' ? 'Ha' : 'Yo\'q'}`);

  // Statistika
  const avgScore = results.reduce((sum, r) => sum + r.scaledScore, 0) / results.length;
  const maxScore = Math.max(...results.map(r => r.scaledScore));
  const minScore = Math.min(...results.map(r => r.scaledScore));
  const certifiedCount = results.filter(r => r.isCertified).length;

  console.log(`\n📊 Statistika:`);
  console.log(`   O'rtacha ball: ${avgScore.toFixed(2)}`);
  console.log(`   Eng yuqori: ${maxScore}`);
  console.log(`   Eng past: ${minScore}`);
  console.log(`   Sertifikat olganlar: ${certifiedCount}/${results.length}`);
}

main()
  .catch(e => console.error('❌ Xatolik:', e))
  .finally(() => prisma.$disconnect());
