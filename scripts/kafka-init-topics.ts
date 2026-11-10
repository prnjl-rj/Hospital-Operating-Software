import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { HospitalKafkaEngine } from '../packages/shared/src/kafka/kafka-outbox-engine';

dotenv.config({ path: resolve(process.cwd(), '.env') });

async function main() {
  console.log('[Kafka Topics] Connecting to Apache Kafka KRaft broker...');
  const engine = new HospitalKafkaEngine();
  try {
    const topics = await engine.ensureHospitalTopics(3, 1);
    const hosTopics = topics.filter((t) => t.startsWith('hospital.')).sort();
    console.log(`✔ [Kafka Topics] Verified ${hosTopics.length} hospital primary + DLQ topics:`);
    for (const t of hosTopics) {
      console.log(`   - ${t}`);
    }
  } finally {
    await engine.disconnectAll();
  }
}

main().catch((err) => {
  console.error('[Kafka Topics] Failed:', err);
  process.exit(1);
});

