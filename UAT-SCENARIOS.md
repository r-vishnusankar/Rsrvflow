# TableFlow — UAT Test Scenarios

**Staging URL:** https://tableflow-staging.up.railway.app  
**Date:** ___________  
**Tester:** ___________

---

## Login credentials

| Role  | Email                        | Password    |
|-------|------------------------------|-------------|
| Admin | admin@spicegarden.com        | Admin1234!  |
| Staff | staff@spicegarden.com        | Staff1234!  |

> **Note:** This is a staging environment. Data resets between test runs if requested.

---

## Scenario 1 — Customer joins queue

1. Open the staging URL on **Device A** (phone or browser tab).
2. The **Customer** tab is shown by default.
3. Enter a name, select party size 2, tap **Join Queue**.
4. ✅ Expected: queue position (e.g. "#4") is shown with estimated wait time.

---

## Scenario 2 — Admin sees the queue update in real time

1. Open the staging URL on **Device B** (different browser or incognito tab).
2. Click **Admin** tab → sign in with admin credentials.
3. ✅ Expected: the new customer from Scenario 1 appears in the queue sidebar within 3 seconds.

---

## Scenario 3 — Admin manually assigns a table

1. On Device B (admin), click a green (available) table on the floor plan.
2. Click **Assign Guest** → select the customer from Scenario 1 → click **Seat**.
3. ✅ Expected: table turns red (occupied), customer disappears from queue, table shows guest name.

---

## Scenario 4 — Customer sees "Table ready" notification

1. On Device A (customer view), wait up to 5 seconds (one poll cycle).
2. ✅ Expected: green "Your table is ready!" banner appears with the table number and zone.
3. ✅ Floor plan highlights the assigned table.

---

## Scenario 5 — Staff marks table as cleaning

1. On Device B, click **Staff** tab → sign in with staff credentials.
2. Find an **Occupied** table → click **Start Cleaning**.
3. ✅ Expected: table status changes to "Cleaning" (amber) on the floor plan.

---

## Scenario 6 — Staff marks table as available

1. Continuing from Scenario 5, find the cleaning table → click **Mark Available**.
2. ✅ Expected: table turns green (available). If there are waiting customers, the system auto-assigns within a few seconds.

---

## Scenario 7 — LLM Auto-Assign

1. Ensure at least 2 customers are waiting in the queue (use Scenario 1 from 2 different browser tabs if needed).
2. On the Admin tab, click **LLM Auto-Assign** in the sidebar.
3. ✅ Expected: spinner appears, then results show which customers were assigned to which tables with reasoning.

---

## Scenario 8 — State persists after page refresh

1. On Device B (admin), note the current table statuses and queue.
2. Hard-refresh the page (Ctrl+R / Cmd+R).
3. ✅ Expected: same table statuses and queue are shown after reload (data comes from DB, not browser cache).

---

## Scenario 9 — Two staff devices see the same queue

1. Open the Admin tab on **Device C** (third browser/tab), sign in with admin credentials.
2. From Device B, assign a customer to a table.
3. ✅ Expected: Device C shows the updated floor plan within 3 seconds without refreshing.

---

## Scenario 10 — Remove customer from queue

1. On Device B (admin), find a waiting customer in the queue sidebar.
2. Click the trash icon next to their name.
3. ✅ Expected: customer is removed from the queue. Other customers' positions update.

---

## Sign-off

| Scenario | Pass | Fail | Notes |
|----------|------|------|-------|
| 1 — Customer joins queue | ☐ | ☐ | |
| 2 — Admin sees real-time update | ☐ | ☐ | |
| 3 — Admin manual assign | ☐ | ☐ | |
| 4 — Customer notified | ☐ | ☐ | |
| 5 — Staff: start cleaning | ☐ | ☐ | |
| 6 — Staff: mark available | ☐ | ☐ | |
| 7 — LLM auto-assign | ☐ | ☐ | |
| 8 — State persists after refresh | ☐ | ☐ | |
| 9 — Two devices in sync | ☐ | ☐ | |
| 10 — Remove from queue | ☐ | ☐ | |

**Overall result:** PASS / FAIL  
**Client sign-off:** ___________  **Date:** ___________
