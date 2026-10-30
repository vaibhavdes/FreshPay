'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const EVENTS = ['paypal.op', 'payout.item', 'milestone', 'contract', 'premium', 'dispute'];

// Re-renders the page from the server whenever a payment, payout or decision changes.
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const source = new EventSource('/api/sse');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };
    EVENTS.forEach((type) => source.addEventListener(type, refresh));
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [router]);

  return null;
}
