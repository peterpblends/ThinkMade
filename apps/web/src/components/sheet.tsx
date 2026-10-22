import { useEffect, useRef, type ReactNode } from 'react';

/** Bottom sheet on phones, centered dialog on wide screens. Uses the native <dialog> for focus and Escape handling. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-3xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/40 sm:m-auto sm:max-w-md sm:rounded-3xl"
    >
      <div className="pb-safe px-5 pt-3">
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        <h2 className="mb-3 text-xl">{title}</h2>
        <div className="pb-5">{children}</div>
      </div>
    </dialog>
  );
}
