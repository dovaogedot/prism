import { NavLink, Outlet } from "react-router";
import { useSession } from "../../auth/session.ts";
import { AdminAccess } from "../admin.ts";
import { StaffGate } from "./StaffGate.tsx";

/**
 * The admin's frame: the sections the staff member's roles open, and the
 * page. Every page under it sits behind the staff gate.
 */
export const AdminLayout = () => {
  const session = useSession();

  const sections = AdminAccess.sectionsFor(session?.roles ?? []);

  const linkClass = ({ isActive }: Readonly<{ isActive: boolean }>) =>
    `block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? "bg-accent-wash text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"
    }`;

  return (
    <StaffGate>
      <div className="mx-auto max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[13rem_1fr] lg:py-8">
        <nav className="mb-6 lg:mb-0" aria-label="Admin">
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">Admin</p>
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {sections.map((section) => (
              <li key={section.path}>
                <NavLink className={linkClass} to={section.path} end={section.path === "/admin"}>
                  {section.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </StaffGate>
  );
};
