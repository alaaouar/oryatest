"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { describeError, listNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { NotificationItem } from "@/lib/types";

/** Lot 4 : notifications in-app du compte connecté. */
export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await listNotifications();
      setItems(data.notifications);
      setUnread(data.unread);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function read(item: NotificationItem) {
    if (item.readAt) return;
    try {
      await markNotificationRead(item.id);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <h1 className="h1">Notifications</h1>
          <p className="subtitle">{unread > 0 ? `${unread} non lue(s)` : "Tout est lu."}</p>
        </div>
        {unread > 0 ? (
          <button className="btn" type="button" onClick={() => void markAllNotificationsRead().then(load)}>
            Tout marquer comme lu
          </button>
        ) : null}
      </div>
      {error ? <div className="alert alert--error">{error}</div> : null}
      {loading ? <p className="muted">Chargement…</p> : null}
      {!loading && items.length === 0 ? <p className="muted">Aucune notification.</p> : null}
      <ul className="list-reset parent-list card">
        {items.map((item) => (
          <li key={item.id} className={`parent-list__item${item.readAt ? "" : " parent-list__item--unread"}`}>
            <div>
              <div>
                <strong>{item.title}</strong>
              </div>
              {item.body ? <div>{item.body}</div> : null}
              <div className="muted">{formatDate(item.createdAt)}</div>
            </div>
            <div className="row">
              {item.link ? (
                <Link className="btn btn--ghost" href={item.link} onClick={() => void read(item)}>
                  Voir
                </Link>
              ) : null}
              {!item.readAt ? (
                <button className="btn btn--ghost" type="button" onClick={() => void read(item)}>
                  Lu
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
