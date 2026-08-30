import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  name?: string;
  placeholder?: string;
  onBlur?: () => void;
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

const MENU_GAP = 7;
const MIN_MENU_HEIGHT = 120;
const PREFERRED_MENU_HEIGHT = 280;

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    value,
    options,
    onChange,
    ariaLabel,
    className,
    disabled = false,
    invalid = false,
    name,
    placeholder = "请选择",
    onBlur,
  },
  forwardedRef,
) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const typeahead = useRef("");
  const typeaheadTimer = useRef<number | null>(null);

  useImperativeHandle(forwardedRef, () => triggerRef.current as HTMLButtonElement);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const enabledIndexes = useMemo(
    () => options.flatMap((option, index) => (option.disabled ? [] : [index])),
    [options],
  );

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const below = window.innerHeight - rect.bottom - viewportPadding - MENU_GAP;
    const above = rect.top - viewportPadding - MENU_GAP;
    const placement = below >= MIN_MENU_HEIGHT || below >= above ? "bottom" : "top";
    const available = Math.max(MIN_MENU_HEIGHT, placement === "bottom" ? below : above);
    const maxHeight = Math.min(PREFERRED_MENU_HEIGHT, available);
    const width = Math.min(
      Math.max(rect.width, 220),
      window.innerWidth - viewportPadding * 2,
    );
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - viewportPadding - width,
    );
    setPosition({
      top: placement === "bottom" ? rect.bottom + MENU_GAP : undefined,
      bottom: placement === "top" ? window.innerHeight - rect.top + MENU_GAP : undefined,
      left,
      width,
      maxHeight,
      placement,
    });
  };

  const closeMenu = (restoreFocus = true) => {
    setOpen(false);
    setPosition(null);
    onBlur?.();
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = (preferredIndex?: number) => {
    if (disabled || enabledIndexes.length === 0) return;
    const fallback = selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : enabledIndexes[0];
    setActiveIndex(preferredIndex ?? fallback);
    // Establish the portal anchor in the same interaction as the open state. WebKit can defer a
    // nested portal's layout effect while a modal is locking body scroll, which would otherwise
    // leave an expanded trigger without a visible listbox for one or more frames.
    updatePosition();
    setOpen(true);
  };

  const moveActive = (direction: 1 | -1) => {
    if (!open) {
      openMenu(direction === 1 ? enabledIndexes[0] : enabledIndexes.at(-1));
      return;
    }
    const currentPosition = enabledIndexes.indexOf(activeIndex);
    const nextPosition = currentPosition < 0
      ? direction === 1 ? 0 : enabledIndexes.length - 1
      : (currentPosition + direction + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[nextPosition]);
  };

  const selectIndex = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeMenu();
  };

  const handleTypeahead = (key: string) => {
    if (typeaheadTimer.current !== null) window.clearTimeout(typeaheadTimer.current);
    typeahead.current += key.toLocaleLowerCase();
    typeaheadTimer.current = window.setTimeout(() => {
      typeahead.current = "";
      typeaheadTimer.current = null;
    }, 650);
    const start = Math.max(0, enabledIndexes.indexOf(activeIndex) + 1);
    const ordered = [...enabledIndexes.slice(start), ...enabledIndexes.slice(0, start)];
    const match = ordered.find((index) =>
      options[index].label.toLocaleLowerCase().startsWith(typeahead.current),
    );
    if (match !== undefined) {
      if (!open) openMenu(match);
      else setActiveIndex(match);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(enabledIndexes[0]);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(enabledIndexes.at(-1) ?? -1);
    } else if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      selectIndex(activeIndex);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    } else if (event.key === "Tab" && open) {
      closeMenu(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      handleTypeahead(event.key);
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        setPosition(null);
        onBlur?.();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onBlur, open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const activeOption = document.getElementById(`${listboxId}-option-${activeIndex}`);
    if (typeof activeOption?.scrollIntoView === "function") {
      activeOption.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, listboxId, open]);

  useEffect(() => () => {
    if (typeaheadTimer.current !== null) window.clearTimeout(typeaheadTimer.current);
  }, []);

  const menuStyle: CSSProperties | undefined = position
    ? {
        top: position.top,
        bottom: position.bottom,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }
    : undefined;

  return (
    <div className={["select-root", className].filter(Boolean).join(" ")} ref={rootRef}>
      {name && <input name={name} type="hidden" value={value} />}
      <button
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        className="select-trigger"
        disabled={disabled || enabledIndexes.length === 0}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span className={selectedOption ? "select-value" : "select-placeholder"}>
          {selectedOption?.label ?? placeholder}
        </span>
        <svg aria-hidden="true" className="select-chevron" viewBox="0 0 16 16">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && position && createPortal(
        <div className="select-portal-layer">
          <div
            className={`select-popover select-popover-${position.placement}`}
            data-placement={position.placement}
            ref={menuRef}
            style={menuStyle}
          >
            <div aria-label={ariaLabel} className="select-listbox" id={listboxId} role="listbox">
              {options.map((option, index) => {
                const selected = option.value === value;
                const active = index === activeIndex;
                return (
                  <div
                    aria-disabled={option.disabled || undefined}
                    aria-selected={selected}
                    className={[
                      "select-option",
                      active ? "select-option-active" : "",
                      selected ? "select-option-selected" : "",
                      option.disabled ? "select-option-disabled" : "",
                    ].filter(Boolean).join(" ")}
                    id={`${listboxId}-option-${index}`}
                    key={option.value}
                    onClick={() => selectIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                    role="option"
                  >
                    <span>
                      <strong>{option.label}</strong>
                      {option.description && <small>{option.description}</small>}
                    </span>
                    <svg aria-hidden="true" className="select-check" viewBox="0 0 16 16">
                      <path d="m3 8 3 3 7-7" />
                    </svg>
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.getElementById("select-portal-root") ?? document.body,
      )}
    </div>
  );
});
