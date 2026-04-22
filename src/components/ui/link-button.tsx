import Link, { type LinkProps } from "next/link";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

type Props = LinkProps &
  VariantProps<typeof buttonVariants> & {
    className?: string;
    children?: React.ReactNode;
    target?: string;
    rel?: string;
    prefetch?: boolean;
  };

export function LinkButton({
  className,
  variant,
  size,
  children,
  prefetch = true,
  ...linkProps
}: Props) {
  return (
    <Link
      prefetch={prefetch}
      className={cn(buttonVariants({ variant, size }), className)}
      {...linkProps}
    >
      {children}
    </Link>
  );
}
