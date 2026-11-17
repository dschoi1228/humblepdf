// Icon-only button with a tooltip, shared by the toolbar and the edit bar.
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function IconButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={props.pressed ? "secondary" : "ghost"}
          size="icon"
          aria-label={props.label}
          aria-pressed={props.pressed}
          disabled={props.disabled}
          onClick={props.onClick}
          data-testid={props.testId}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

export const Divider = () => <Separator orientation="vertical" className="mx-1 !h-6" />;
