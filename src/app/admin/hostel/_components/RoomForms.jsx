"use client";

import { useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { downloadCsv, parseCsv } from "./hostelExport";
import {
  Field,
  FormModal,
  SelectField,
  TextField,
  inputClass,
} from "./hostelUi";

const FACILITIES = ["Attached Bathroom", "AC", "Fan", "Wi-Fi", "Balcony", "Study Table"];
const MAX_BULK_ROOMS = 500;

export const ROOM_TYPES = { STANDARD: "Standard", DELUXE: "Deluxe" };
const ROOM_TYPE_OPTIONS = Object.entries(ROOM_TYPES).map(([value, label]) => ({ value, label }));

const CSV_HEADERS = ["hostel", "building", "floor", "room_number", "room_type", "capacity", "facilities", "notes"];

const emptyShared = {
  hostelName: "",
  building: "",
  floor: "",
  roomType: "STANDARD",
  capacity: "4",
  facilities: [],
};

function FacilitiesField({ value, onChange }) {
  // Keeps any saved facility that is not in the standard list.
  const options = [...new Set([...FACILITIES, ...value])];

  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-2 text-sm font-medium text-slate-700">Facilities</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((facility) => (
          <label key={facility} className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={value.includes(facility)}
              onChange={() =>
                onChange(
                  value.includes(facility)
                    ? value.filter((item) => item !== facility)
                    : [...value, facility]
                )
              }
            />
            {facility}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SharedRoomFields({ form, setValue, hostelNames }) {
  return (
    <>
      <TextField
        id="room-hostel"
        label="Hostel *"
        value={form.hostelName}
        onChange={setValue("hostelName")}
        list="room-hostel-names"
        placeholder="e.g. Boys Hostel"
      />
      <datalist id="room-hostel-names">
        {hostelNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <TextField
        id="room-building"
        label="Building *"
        value={form.building}
        onChange={setValue("building")}
        placeholder="e.g. A Block"
      />
      <TextField
        id="room-floor"
        label="Floor *"
        value={form.floor}
        onChange={setValue("floor")}
        placeholder="e.g. 1st Floor"
      />
    </>
  );
}

export function RoomForm({ room, hostelNames, onClose, onSaved }) {
  const [form, setForm] = useState(() =>
    room
      ? {
          hostelName: room.hostelName,
          building: room.building,
          floor: room.floor,
          roomNumber: room.roomNumber,
          roomType: room.roomType,
          capacity: String(room.capacity),
          facilities: room.facilities,
          underMaintenance: room.underMaintenance,
          notes: room.notes,
        }
      : { ...emptyShared, roomNumber: "", underMaintenance: false, notes: "" }
  );

  const setValue = (key) => (value) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const handleSubmit = async () => {
    const payload = { ...form, capacity: Number(form.capacity) };

    if (room) {
      await hostelService.updateRoom(room.id, payload);
    } else {
      await hostelService.createRoom(payload);
    }
    onSaved();
  };

  return (
    <FormModal
      title={room ? `Edit Room ${room.roomNumber}` : "Add New Room"}
      submitLabel="Save Room"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <SharedRoomFields form={form} setValue={setValue} hostelNames={hostelNames} />
      <TextField
        id="room-number"
        label="Room Number *"
        value={form.roomNumber}
        onChange={setValue("roomNumber")}
        placeholder="e.g. 101"
      />
      <SelectField
        id="room-type"
        label="Room Type"
        value={form.roomType}
        onChange={setValue("roomType")}
        options={ROOM_TYPE_OPTIONS}
      />
      <TextField
        id="room-capacity"
        label="Capacity (seats) *"
        type="number"
        min="1"
        value={form.capacity}
        onChange={setValue("capacity")}
      />
      <FacilitiesField value={form.facilities} onChange={setValue("facilities")} />

      <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
        <input
          type="checkbox"
          checked={form.underMaintenance}
          onChange={(event) => setValue("underMaintenance")(event.target.checked)}
        />
        Under maintenance
      </label>

      <Field id="room-notes" label="Notes" wide>
        <textarea
          id="room-notes"
          rows={2}
          maxLength={500}
          value={form.notes}
          onChange={(event) => setValue("notes")(event.target.value)}
          className={inputClass}
        />
      </Field>
    </FormModal>
  );
}

const roomsFromCsv = (text) => {
  const [header, ...rows] = parseCsv(text);
  const columns = (header || []).map((cell) => cell.trim().toLowerCase());

  const missing = ["hostel", "building", "floor", "room_number", "capacity"].filter(
    (name) => !columns.includes(name)
  );
  if (missing.length > 0) {
    throw new Error(`The file is missing these columns: ${missing.join(", ")}.`);
  }

  return rows.map((cells) => {
    const read = (name) => cells[columns.indexOf(name)]?.trim() || "";

    return {
      hostelName: read("hostel"),
      building: read("building"),
      floor: read("floor"),
      roomNumber: read("room_number"),
      roomType: read("room_type").toUpperCase() || "STANDARD",
      capacity: Number(read("capacity")),
      facilities: read("facilities")
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean),
      notes: read("notes"),
    };
  });
};

const downloadTemplate = () => {
  const example = {
    hostel: "Boys Hostel",
    building: "A Block",
    floor: "1st Floor",
    room_number: "101",
    room_type: "STANDARD",
    capacity: 4,
    facilities: "Fan;Wi-Fi",
    notes: "",
  };

  downloadCsv(
    "hostel-rooms-template.csv",
    CSV_HEADERS.map((name) => ({ label: name, value: (row) => row[name] })),
    [example]
  );
};

export function BulkRoomForm({ hostelNames, onClose, onSaved }) {
  const [mode, setMode] = useState("range");
  const [form, setForm] = useState({ ...emptyShared, prefix: "", from: "101", to: "110" });
  const [csvRooms, setCsvRooms] = useState(null);
  const [csvError, setCsvError] = useState("");

  const setValue = (key) => (value) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const from = Number(form.from);
  const to = Number(form.to);
  const rangeCount =
    Number.isInteger(from) && Number.isInteger(to) && to >= from ? to - from + 1 : 0;

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    setCsvRooms(null);
    setCsvError("");
    if (!file) return;

    try {
      const rooms = roomsFromCsv(await file.text());
      if (rooms.length === 0) throw new Error("The file has no rooms.");
      setCsvRooms(rooms);
    } catch (err) {
      setCsvError(err.message);
    }
  };

  const handleSubmit = async () => {
    let rooms = csvRooms;

    if (mode === "range") {
      if (rangeCount === 0) {
        throw new Error('Enter a valid range: "To" must not be lower than "From".');
      }
      if (rangeCount > MAX_BULK_ROOMS) {
        throw new Error(`A bulk add can have at most ${MAX_BULK_ROOMS} rooms.`);
      }

      const { prefix, from: _from, to: _to, ...shared } = form;
      rooms = Array.from({ length: rangeCount }, (_, index) => ({
        ...shared,
        capacity: Number(form.capacity),
        roomNumber: `${prefix.trim()}${from + index}`,
      }));
    } else if (!rooms) {
      throw new Error("Choose a CSV file first.");
    }

    await hostelService.bulkCreateRooms(rooms);
    onSaved();
  };

  const tabClass = (name) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${
      mode === name ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
    }`;

  const roomCount = mode === "range" ? rangeCount : csvRooms?.length || 0;

  return (
    <FormModal
      title="Bulk Add Rooms"
      submitLabel={`Add ${roomCount} Room${roomCount === 1 ? "" : "s"}`}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" onClick={() => setMode("range")} className={tabClass("range")}>
          Number Range
        </button>
        <button type="button" onClick={() => setMode("csv")} className={tabClass("csv")}>
          CSV File
        </button>
      </div>

      {mode === "range" ? (
        <>
          <SharedRoomFields form={form} setValue={setValue} hostelNames={hostelNames} />
          <SelectField
            id="room-type"
            label="Room Type"
            value={form.roomType}
            onChange={setValue("roomType")}
            options={ROOM_TYPE_OPTIONS}
          />
          <TextField
            id="room-capacity"
            label="Seats per Room *"
            type="number"
            min="1"
            value={form.capacity}
            onChange={setValue("capacity")}
          />
          <TextField
            id="bulk-prefix"
            label="Room Number Prefix"
            value={form.prefix}
            onChange={setValue("prefix")}
            placeholder="e.g. A-"
          />
          <TextField
            id="bulk-from"
            label="From *"
            type="number"
            value={form.from}
            onChange={setValue("from")}
          />
          <TextField
            id="bulk-to"
            label="To *"
            type="number"
            value={form.to}
            onChange={setValue("to")}
          />
          <FacilitiesField value={form.facilities} onChange={setValue("facilities")} />
        </>
      ) : (
        <div className="space-y-3 sm:col-span-2">
          <p className="text-sm text-slate-600">
            Upload a CSV file. For an Excel workbook, use Save As → CSV first. Separate
            facilities with a semicolon. If any row has a problem, no rooms are added.
          </p>
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            Download template
          </button>
          <Field id="bulk-file" label="CSV File">
            <input
              id="bulk-file"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className={inputClass}
            />
          </Field>
          {csvRooms && (
            <p className="text-sm text-green-700">{csvRooms.length} room(s) ready to add.</p>
          )}
          {csvError && (
            <p role="alert" className="text-sm text-red-700">
              {csvError}
            </p>
          )}
        </div>
      )}
    </FormModal>
  );
}
