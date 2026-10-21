import { Link } from "react-router";
import { CartPreviewButton } from "../../features/cart/components/index.ts";
import { CategoryMenu } from "../../features/catalog/components/CategoryMenu.tsx";
import { SearchCombobox } from "../../features/catalog/components/SearchCombobox.tsx";
import { AccountMenu } from "./AccountMenu.tsx";
import { LookClass } from "./look.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

/** What the menu button does: open the drawer. */
export type HeaderProps = Readonly<{ onOpenMenu: () => void }>;

/**
 * The bar on top of every page: the menu button on a narrow page, the
 * logo, the shop's categories, the search box, the theme switch, the cart
 * and the account. Below medium width the search box takes a row of its own.
 */
export const Header = ({ onOpenMenu }: HeaderProps) => (
  <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
    <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 sm:gap-x-3 sm:px-6 md:h-16 md:flex-nowrap md:py-0">
      <button className={`${LookClass.icon} lg:hidden`} type="button" onClick={onOpenMenu} aria-label="Open menu" aria-haspopup="dialog">
        <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <Link className="shrink-0 text-[0.9375rem] font-semibold tracking-tight text-ink" to="/">
        Prism
      </Link>

      <nav className="hidden lg:block" aria-label="Shop">
        <CategoryMenu />
      </nav>

      {/* The last row on a narrow page; beside the logo from medium width up, taking most of the free space. */}
      <div className="order-last w-full md:order-none md:mx-2 md:w-auto md:max-w-xl md:flex-[3]">
        <SearchCombobox />
      </div>

      <div className="flex-1" />

      <div className="hidden lg:block">
        <ThemeToggle look="icon" />
      </div>

      <CartPreviewButton />

      <AccountMenu />
    </div>
  </header>
);
