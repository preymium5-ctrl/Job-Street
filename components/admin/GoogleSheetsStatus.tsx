"use client";

import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { AdminApiError, adminRequest, errorMessage } from "./api";
import styles from "./GoogleSheetsStatus.module.css";

interface SheetsStatus {
  configured: boolean;
  configuration: "configured" | "not-configured" | "invalid";
  pending: number;
  processing: number;
  synced: number;
  failed: number;
  result?: { delivered: number; deferred: number; configured: boolean };
}

const endpoint = "/api/admin/integrations/google-sheets";

export default function GoogleSheetsStatus({
  onSessionExpired,
}: {
  onSessionExpired: () => void;
}) {
  const [status, setStatus] = useState<SheetsStatus | null>(null);
  const [busy, setBusy] = useState<"loading" | "refresh" | "retry" | null>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    adminRequest<SheetsStatus>(endpoint, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setStatus(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof AdminApiError && err.status === 401) onSessionExpired();
        else setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          lock.current = false;
          setBusy(null);
        }
      });
    return () => controller.abort();
  }, [onSessionExpired]);

  async function refresh(retry = false) {
    if (lock.current || (retry && !status?.configured)) return;
    lock.current = true;
    setBusy(retry ? "retry" : "refresh");
    setError("");
    setNotice("");
    try {
      const data = await adminRequest<SheetsStatus>(endpoint, {
        method: retry ? "POST" : "GET",
      });
      setStatus(data);
      if (retry && data.result) {
        const { delivered, deferred } = data.result;
        setNotice(
          `Delivery check complete: ${delivered} delivered, ${deferred} deferred. ${data.pending} application${data.pending === 1 ? " remains" : "s remain"} queued.`,
        );
      } else {
        setNotice("Delivery status refreshed.");
      }
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) onSessionExpired();
      else setError(errorMessage(err));
    } finally {
      setBusy(null);
      lock.current = false;
    }
  }

  return (
    <section
      className={styles.panel}
      aria-labelledby="sheets-status-heading"
      aria-busy={Boolean(busy)}
    >
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}><FileSpreadsheet size={16} /> Application delivery</p>
          <h2 id="sheets-status-heading">Your Google Sheet.</h2>
        </div>
      </div>
      {status ? (
        <div className={styles.configuration}>
          <strong>
            {status.configured
              ? "Google Sheets configuration present"
              : status.configuration === "invalid"
                ? "Google Sheets setup needs attention"
                : "Google authorization / setup required"}
          </strong>
          <p>
            {status.configured
              ? "Applications are queued for automatic delivery. The Delivered count shows applications acknowledged by the sheet."
              : "One-time Google authorization and connection setup must be completed before automatic delivery can begin. Applications remain saved privately on the website and queued for delivery."}
          </p>
        </div>
      ) : busy === "loading" ? (
        <p className={styles.help} role="status">Checking application delivery…</p>
      ) : null}
      <dl className={styles.counts}>
        {[
          ["Queued", status?.pending],
          ["Processing", status?.processing],
          ["Delivered", status?.synced],
          ["Delivery errors", status?.failed],
        ].map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{count ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {Boolean(status?.failed) && (
        <p className={styles.help}>
          Applications with a failed delivery stay queued for another attempt.
          Review setup if errors continue.
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void refresh()}
          disabled={Boolean(busy)}
        >
          <RefreshCw size={15} /> {busy === "refresh" ? "Refreshing…" : "Refresh delivery status"}
        </button>
        <button
          type="button"
          className="button button-outline"
          onClick={() => void refresh(true)}
          disabled={Boolean(busy) || !status?.configured || !status.pending}
        >
          {busy === "retry" ? "Retrying…" : "Retry pending applications"}
        </button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>
  );
}
