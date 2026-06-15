import { describe, expect, it } from "vitest";
import { isConfigUnlocked, validatePart1, type Part1Input } from "@/lib/part1-config";

// Exhaustive coverage of idea/veriffica-part-1-validation-rules.md: per-field
// accept/reject boundaries, every normalization, the CF-1 cross-field block,
// optional-empty→null, and the isConfigUnlocked predicate (incl. the electric +
// manual case that is individually valid but CF-1-locked).

// A fully valid minimal input: the six required fields valid, every optional empty.
function validInput(overrides: Partial<Part1Input> = {}): Part1Input {
  return {
    price: "",
    make: "Toyota",
    model: "Corolla",
    year: "2020",
    registrationNumber: "WX 1234A",
    vin: "",
    mileage: "",
    fuelType: "petrol",
    transmission: "manual",
    drive: "2wd",
    color: "",
    bodyType: "hatchback",
    doorCount: "",
    address: "",
    notes: "",
    ...overrides,
  };
}

const parse = (overrides: Partial<Part1Input> = {}) => validatePart1(validInput(overrides));

describe("validatePart1 — happy path", () => {
  it("accepts the six required fields with all optionals empty", () => {
    const result = parse();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({
        price: null,
        make: "Toyota",
        model: "Corolla",
        year: 2020,
        registrationNumber: "WX 1234A",
        vin: null,
        mileage: null,
        fuelType: "petrol",
        transmission: "manual",
        drive: "2wd",
        color: null,
        bodyType: "hatchback",
        doorCount: null,
        address: null,
        notes: null,
      });
    }
  });
});

describe("required fields reject when empty (exact §9 copy)", () => {
  // Only the six PRD-required fields (FR-013). Year/Registration are optional.
  const cases: { field: keyof Part1Input; message: string }[] = [
    { field: "make", message: "Enter the car make." },
    { field: "model", message: "Enter the car model." },
    { field: "fuelType", message: "Select the fuel type." },
    { field: "transmission", message: "Select the transmission type." },
    { field: "drive", message: "Select the drive type." },
    { field: "bodyType", message: "Select the body type." },
  ];
  it.each(cases)("$field empty → $message", ({ field, message }) => {
    const result = parse({ [field]: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toBe(message);
  });
});

describe("normalization (rules §8 payload shape)", () => {
  it("trims + collapses spaces in text, uppercases registration/VIN, lowercases enums", () => {
    const result = parse({
      price: "24999,99",
      make: "  Toyota   Motors ",
      model: " Corolla ",
      registrationNumber: "wx 1234a",
      vin: "sb1k93be60e123456",
      mileage: "135 000",
      fuelType: "Hybrid",
      transmission: "Automatic",
      drive: "2WD",
      bodyType: "Hatchback",
      color: "  Silver ",
      doorCount: "5",
      address: " Warsaw,   Poland ",
      notes: "  line1\nline2  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.price).toBe(24999.99);
      expect(result.config.make).toBe("Toyota Motors");
      expect(result.config.model).toBe("Corolla");
      expect(result.config.registrationNumber).toBe("WX 1234A");
      expect(result.config.vin).toBe("SB1K93BE60E123456");
      expect(result.config.mileage).toBe(135000);
      expect(result.config.fuelType).toBe("hybrid");
      expect(result.config.transmission).toBe("automatic");
      expect(result.config.drive).toBe("2wd");
      expect(result.config.bodyType).toBe("hatchback");
      expect(result.config.color).toBe("Silver");
      expect(result.config.doorCount).toBe(5);
      expect(result.config.address).toBe("Warsaw, Poland");
      // internal newline preserved, leading/trailing trimmed
      expect(result.config.notes).toBe("line1\nline2");
    }
  });
});

describe("optional fields persist null when empty, validate when present", () => {
  it("all optionals empty → null", () => {
    const result = parse({ year: "", registrationNumber: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const f of [
        "price",
        "year",
        "registrationNumber",
        "vin",
        "mileage",
        "color",
        "doorCount",
        "address",
        "notes",
      ] as const) {
        expect(result.config[f]).toBeNull();
      }
    }
  });

  it("invalid optional VIN (contains I/O/Q) blocks save with its message", () => {
    const bad = parse({ vin: "IOQ1234567890ABCD" }); // 17 chars but contains I, O, Q
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.vin).toBe("VIN must contain exactly 17 letters and digits without I, O or Q.");
  });
});

describe("field boundaries", () => {
  const reject: { name: string; input: Partial<Part1Input>; field: keyof Part1Input }[] = [
    { name: "make 51 chars", input: { make: "a".repeat(51) }, field: "make" },
    { name: "model 61 chars", input: { model: "a".repeat(61) }, field: "model" },
    { name: "year 1885", input: { year: "1885" }, field: "year" },
    { name: "year above current", input: { year: String(new Date().getFullYear() + 1) }, field: "year" },
    { name: "year non-numeric", input: { year: "20ab" }, field: "year" },
    { name: "registration 1 char", input: { registrationNumber: "A" }, field: "registrationNumber" },
    { name: "registration 16 chars", input: { registrationNumber: "A".repeat(16) }, field: "registrationNumber" },
    { name: "registration illegal char", input: { registrationNumber: "WX_1234" }, field: "registrationNumber" },
    { name: "vin 16 chars", input: { vin: "A".repeat(16) }, field: "vin" },
    { name: "vin with I", input: { vin: "I".repeat(17) }, field: "vin" },
    { name: "mileage above max", input: { mileage: "10000000" }, field: "mileage" },
    { name: "mileage non-numeric", input: { mileage: "12a" }, field: "mileage" },
    { name: "price 3 decimals", input: { price: "10.123" }, field: "price" },
    { name: "price above max", input: { price: "10000000001" }, field: "price" },
    { name: "price negative", input: { price: "-5" }, field: "price" },
    { name: "doorCount 8", input: { doorCount: "8" }, field: "doorCount" },
    { name: "doorCount 10", input: { doorCount: "10" }, field: "doorCount" },
    { name: "color 41 chars", input: { color: "a".repeat(41) }, field: "color" },
    { name: "address 4 chars", input: { address: "abcd" }, field: "address" },
    { name: "address 151 chars", input: { address: "a".repeat(151) }, field: "address" },
    { name: "notes 1001 chars", input: { notes: "a".repeat(1001) }, field: "notes" },
    { name: "fuelType invalid", input: { fuelType: "plasma" }, field: "fuelType" },
    { name: "transmission invalid", input: { transmission: "cvt" }, field: "transmission" },
    { name: "drive invalid", input: { drive: "6wd" }, field: "drive" },
    { name: "bodyType invalid", input: { bodyType: "spaceship" }, field: "bodyType" },
  ];
  it.each(reject)("rejects $name", ({ input, field }) => {
    const result = parse(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toBeDefined();
  });

  const accept: { name: string; input: Partial<Part1Input> }[] = [
    { name: "make 50 chars", input: { make: "a".repeat(50) } },
    { name: "model 60 chars", input: { model: "a".repeat(60) } },
    { name: "year 1886", input: { year: "1886" } },
    { name: "year current", input: { year: String(new Date().getFullYear()) } },
    { name: "registration 2 chars", input: { registrationNumber: "AB" } },
    { name: "registration 15 chars", input: { registrationNumber: "A".repeat(15) } },
    { name: "vin 17 valid chars", input: { vin: "SB1K93BE60E123456" } },
    { name: "mileage max", input: { mileage: "9999999" } },
    { name: "mileage 0", input: { mileage: "0" } },
    { name: "price max", input: { price: "10000000000" } },
    { name: "price 2 decimals", input: { price: "0.99" } },
    { name: "doorCount 0", input: { doorCount: "0" } },
    { name: "doorCount 7", input: { doorCount: "7" } },
    { name: "color 40 chars", input: { color: "a".repeat(40) } },
    { name: "address 5 chars", input: { address: "abcde" } },
    { name: "address 150 chars", input: { address: "a".repeat(150) } },
    { name: "notes 1000 chars", input: { notes: "a".repeat(1000) } },
  ];
  it.each(accept)("accepts $name", ({ input }) => {
    expect(parse(input).ok).toBe(true);
  });
});

describe("CF-1 cross-field — Electric requires Automatic", () => {
  it("electric + manual is blocked with the exact message on transmission", () => {
    const result = parse({ fuelType: "electric", transmission: "manual" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.transmission).toBe("Electric cars must use Automatic transmission.");
  });

  it("electric + automatic passes", () => {
    expect(parse({ fuelType: "electric", transmission: "automatic" }).ok).toBe(true);
  });

  it("non-electric + manual passes", () => {
    expect(parse({ fuelType: "petrol", transmission: "manual" }).ok).toBe(true);
  });
});

describe("isConfigUnlocked predicate", () => {
  it("true when all six required valid and optionals empty", () => {
    expect(isConfigUnlocked(validInput())).toBe(true);
  });

  it("true with the six required valid even when Year + Registration are empty (both optional)", () => {
    expect(isConfigUnlocked(validInput({ year: "", registrationNumber: "" }))).toBe(true);
  });

  it.each(["make", "model", "fuelType", "transmission", "drive", "bodyType"] as const)(
    "false when required field %s is missing",
    (field) => {
      expect(isConfigUnlocked(validInput({ [field]: "" }))).toBe(false);
    },
  );

  it("false for electric + manual even though all six fields are present (CF-1 guard)", () => {
    expect(isConfigUnlocked(validInput({ fuelType: "electric", transmission: "manual" }))).toBe(false);
  });

  it("false when an optional field is invalid (mirrors would-a-Save-succeed)", () => {
    expect(isConfigUnlocked(validInput({ vin: "IOQ1234567890ABCD" }))).toBe(false);
  });
});
