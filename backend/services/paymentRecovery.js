import { recoverBookingOperations } from "./queueBooking.js";
import { recoverAppointmentRefunds } from "./appointmentRefund.js";
export const recoverPayments = async () => ({ bookings: await recoverBookingOperations(), refunds: await recoverAppointmentRefunds() });
export const startPaymentRecoveryWorker = () => {
  let running = false, stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await recoverPayments(); } catch { console.error("Demo payment recovery needs retry"); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(tick, 30000); timer.unref();
  return () => { stopped = true; clearInterval(timer); };
};
