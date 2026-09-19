import { getDatabase } from '../../db/connection.js';
import { NotificationService } from './notification.service.js';

export class BishiSchedulerService {
  private static timerId: NodeJS.Timeout | null = null;

  public static getTodayIST(date = new Date()): string {
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + istOffsetMs);
    const year = istDate.getUTCFullYear();
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  public static async runReminderCycle(mockDate?: Date): Promise<{
    processedRecords: number;
    remindersSent: number;
    overdueUpdated: number;
  }> {
    const db = getDatabase();
    const todayStr = this.getTodayIST(mockDate);
    const today = new Date(todayStr + 'T00:00:00Z');

    const records = db
      .prepare(`
        SELECT r.id, r.organization_id, r.member_id, r.expected_amount, r.due_date, r.month_year, r.status,
               u.full_name as member_name
        FROM bishi_records r
        INNER JOIN users u ON r.member_id = u.id AND r.organization_id = u.organization_id
        INNER JOIN organizations o ON r.organization_id = o.id
        WHERE u.is_active = 1 AND r.status IN ('PENDING', 'OVERDUE')
      `)
      .all() as Array<{
        id: string;
        organization_id: string;
        member_id: string;
        expected_amount: number;
        due_date: string;
        month_year: string;
        status: string;
        member_name: string;
      }>;

    let remindersSent = 0;
    let overdueUpdated = 0;

    for (const rec of records) {
      const dueDate = new Date(rec.due_date + 'T00:00:00Z');
      const diffTimeMs = dueDate.getTime() - today.getTime();
      const diffDays = Math.round(diffTimeMs / (1000 * 60 * 60 * 24));

      // Case 1: Due date approaching (2 days before)
      if (diffDays === 2 && rec.status === 'PENDING') {
        const idempotencyKey = `bishi-due-approach-${rec.id}-${todayStr}`;
        const sent = await NotificationService.sendNotification({
          organizationId: rec.organization_id,
          userId: rec.member_id,
          type: 'BISHI_DUE',
          title: 'बिशी देय तारीख जवळ आली आहे',
          message: `${rec.month_year} महिन्याची ₹${rec.expected_amount} बिशी भरण्याची अंतिम तारीख ${rec.due_date} आहे.`,
          entityType: 'BISHI',
          entityId: rec.id,
          idempotencyKey,
          data: {
            bishiRecordId: rec.id,
            amount: rec.expected_amount,
            dueDate: rec.due_date,
            monthYear: rec.month_year,
          },
        });
        if (sent) remindersSent++;
      }

      // Case 2: Due today
      else if (diffDays === 0 && rec.status === 'PENDING') {
        const idempotencyKey = `bishi-due-today-${rec.id}-${todayStr}`;
        const sent = await NotificationService.sendNotification({
          organizationId: rec.organization_id,
          userId: rec.member_id,
          type: 'BISHI_DUE_TODAY',
          title: 'आज बिशी भरण्याचा दिवस आहे',
          message: `${rec.month_year} महिन्याची ₹${rec.expected_amount} बिशी भरण्याचा आज शेवटचा दिवस आहे.`,
          entityType: 'BISHI',
          entityId: rec.id,
          idempotencyKey,
          data: {
            bishiRecordId: rec.id,
            amount: rec.expected_amount,
            dueDate: rec.due_date,
            monthYear: rec.month_year,
          },
        });
        if (sent) remindersSent++;
      }

      // Case 3: Overdue (today > dueDate)
      else if (diffDays < 0) {
        if (rec.status === 'PENDING') {
          db.prepare("UPDATE bishi_records SET status = 'OVERDUE', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(rec.id);
          overdueUpdated++;
        }

        const idempotencyKey = `bishi-overdue-${rec.id}-${rec.month_year}`;
        const sent = await NotificationService.sendNotification({
          organizationId: rec.organization_id,
          userId: rec.member_id,
          type: 'BISHI_OVERDUE',
          title: 'बिशी हप्ता थकीत (Overdue) आहे',
          message: `${rec.month_year} महिन्याची ₹${rec.expected_amount} बिशी देय तारीख (${rec.due_date}) उलटून गेली आहे. कृपया लवकरात लवकर भरा.`,
          entityType: 'BISHI',
          entityId: rec.id,
          idempotencyKey,
          data: {
            bishiRecordId: rec.id,
            amount: rec.expected_amount,
            dueDate: rec.due_date,
            monthYear: rec.month_year,
          },
        });
        if (sent) remindersSent++;
      }
    }

    return {
      processedRecords: records.length,
      remindersSent,
      overdueUpdated,
    };
  }

  public static startSchedule(intervalMs = 60 * 60 * 1000): void {
    if (this.timerId) return;
    this.timerId = setInterval(() => {
      this.runReminderCycle().catch(err => {
        console.error('Bishi reminder scheduler error:', err);
      });
    }, intervalMs);
  }

  public static stopSchedule(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}
