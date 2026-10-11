import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { regionQuery } from "./api";
import { usePreferences } from "./store";
import type { Region } from "./types";

export default function CityPicker({
  onSelect,
  onClear,
}: {
  onSelect: (city: Region) => void;
  onClear: () => void;
}) {
  const search = usePreferences((s) => s.search);
  const setSearch = usePreferences((s) => s.setSearch);
  const selected = usePreferences((s) => s.region);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [debounced, setDebounced] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const term = search.trim();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 350);
    return () => clearTimeout(timer);
  }, [term]);
  const options = regionQuery(debounced);
  const query = useQuery({
    ...options,
    enabled:
      open &&
      term.length >= 2 &&
      term === debounced &&
      selected?.name !== search,
  });
  const suggestions = term === debounced ? (query.data ?? []) : [];
  const visible = open && term.length >= 2 && selected?.name !== search;
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const choose = (city: Region) => {
    onSelect(city);
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  };
  return (
    <div
      className="city-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <label htmlFor={id}>Find a city</label>
      <div className="city-input">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            visible && suggestions[active]
              ? `${id}-option-${active}`
              : undefined
          }
          value={search}
          autoComplete="off"
          placeholder="Search for a city (at least 2 letters)"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setSearch(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              setActive(-1);
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (suggestions.length)
                setActive((current) =>
                  event.key === "ArrowDown"
                    ? (current + 1) % suggestions.length
                    : current <= 0
                      ? suggestions.length - 1
                      : current - 1,
                );
            }
            if (event.key === "Enter" && visible && suggestions[active]) {
              event.preventDefault();
              choose(suggestions[active]);
            }
          }}
        />
        {search && (
          <button
            className="city-clear"
            type="button"
            aria-label="Clear selected city"
            onClick={() => {
              onClear();
              setOpen(false);
              setActive(-1);
              input.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </div>
      {visible && (
        <div className="city-dropdown">
          {(term !== debounced || query.isFetching) && (
            <p role="status">Searching locations…</p>
          )}
          {query.isError && (
            <p role="alert">
              City search unavailable. Enter coordinates below.
            </p>
          )}
          {term === debounced && query.isSuccess && !suggestions.length && (
            <p role="status">No matching cities. Try another name.</p>
          )}
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label="City suggestions"
          >
            {suggestions.map((city, index) => (
              <li
                id={`${id}-option-${index}`}
                key={city.id}
                role="option"
                aria-selected={active === index}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(city)}
              >
                {city.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
