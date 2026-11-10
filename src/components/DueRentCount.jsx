"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { hostelService } from "@/lib/erpServices";

const REFRESH_MS = 60_000;

// Shows the number of students with overdue rent next to the menu item.
export default function DueRentCount() {
  const pathname = usePathname();
  const [count, setCount] = useState(null);

  useEffect(() => {
    let isCurrent = true;

    const load = () =>
      hostelService
        .getDueRentCount()
        .then((result) => {
          if (isCurrent) setCount(result.students);
        })
        .catch(() => {
          // The menu stays usable; the page itself explains any problem.
        });

    load();
    const timer = setInterval(load, REFRESH_MS);

    return () => {
      isCurrent = false;
      clearInterval(timer);
    };
  }, [pathname]);

  if (count === null) return null;

  return <span className="tabular-nums">({count})</span>;
}
