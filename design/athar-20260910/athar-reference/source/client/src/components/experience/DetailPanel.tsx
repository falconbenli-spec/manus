import { useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
export default function DetailPanel({
  open,
  onClose,
  title,
  children,
  side = false,
  className = "",
  returnFocusLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  side?: boolean;
  className?: string;
  returnFocusLabel?: string;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="athar-overlay" />
        <Dialog.Content
          className={`athar-detail ${side ? "athar-detail--side" : "athar-detail--center"} ${className}`}
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement &&
              document.activeElement !== document.body
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => {
              if (document.querySelector("[role=dialog]")) return;
              const origin = returnFocus.current?.isConnected
                ? returnFocus.current
                : [...document.querySelectorAll<HTMLElement>("button")].find(
                    (button) =>
                      button.getAttribute("aria-label") ===
                        (returnFocusLabel || `فتح الطلب: ${title}`) ||
                      button.textContent?.trim() === returnFocusLabel,
                  );
              origin?.focus();
            });
          }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
          <Dialog.Close className="athar-close" aria-label="إغلاق التفاصيل">
            <X size={18} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
