# Veriffica Part 1 Validation Rules

This document defines strict validation rules for the `Info about the car` form.

## 1. Validation goals

- block access to Parts 2-5 until all required Part 1 fields are valid
- keep validation strict but readable for non-technical users
- allow optional fields to remain empty, but validate them strictly when filled
- normalize values consistently before saving and before generating the session title

## 2. Validation timing

| Event | Behavior |
| --- | --- |
| On input | Soft validation for formatting hints only |
| On blur | Inline validation for the current field |
| On submit / leave Part 1 | Full blocking validation for the whole form |
| On successful save | Persist normalized values locally and update session title |

## 3. UX requirements

| Rule ID | Requirement |
| --- | --- |
| `UX-1` | Show inline error text directly under the invalid field |
| `UX-2` | Scroll to the first invalid field on submit |
| `UX-3` | Focus the first invalid field after scroll |
| `UX-4` | Use plain English error messages |
| `UX-5` | Keep Parts 2-5 disabled until required fields are valid |
| `UX-6` | Normalize values before saving, but do not silently change the semantic meaning of the input |

## 4. Field-by-field validation table

| Field ID | Label | Required | Type | Validation rule | Normalization | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| `price` | Price | No | decimal | If present: numeric value `>= 0` and `<= 10000000`, max 2 decimal places | trim, replace comma with dot, parse decimal | `Enter a valid price greater than or equal to 0.` |
| `make` | Make | Yes | text | 1-50 characters after trim | trim, collapse repeated spaces | `Enter the car make.` |
| `model` | Model | Yes | text | 1-60 characters after trim | trim, collapse repeated spaces | `Enter the car model.` |
| `year` | Year of production | Yes | integer | 4 digits, `>= 1886`, `<= current year + 1` | trim, parse integer | `Enter a valid production year.` |
| `registrationNumber` | Registration number | Yes | text | 2-15 characters after trim; allowed chars: letters, digits, spaces, hyphen | trim, uppercase, collapse repeated spaces | `Enter a valid registration number.` |
| `vin` | VIN number | No | text | If present: exactly 17 chars, regex `^[A-HJ-NPR-Z0-9]{17}$` | trim, uppercase | `VIN must contain exactly 17 letters and digits without I, O or Q.` |
| `mileage` | Mileage | No | integer | If present: whole number `>= 0` and `<= 9999999` | trim, remove spaces, parse integer | `Enter a valid mileage.` |
| `fuelType` | Fuel type | Yes | enum | Must match one of: `Petrol`, `Diesel`, `Hybrid`, `Electric` | store as lowercase enum key | `Select the fuel type.` |
| `transmission` | Transmission | Yes | enum | Must match one of: `Manual`, `Automatic` | store as lowercase enum key | `Select the transmission type.` |
| `drive` | Drive | Yes | enum | Must match one of: `2WD`, `4WD` | store as lowercase enum key | `Select the drive type.` |
| `color` | Color | No | text | If present: 1-40 characters after trim | trim, collapse repeated spaces | `Enter a valid color.` |
| `bodyType` | Body type | Yes | enum | Must match one of: `Sedan`, `Hatchback`, `SUV`, `Coupe`, `Convertible`, `Van`, `Pickup`, `Other` | store as lowercase enum key | `Select the body type.` |
| `doorCount` | No of doors | No | integer | If present: whole number from 1 to 9 | trim, parse integer | `Enter a valid number of doors.` |
| `address` | Address | No | text | If present: 5-150 characters after trim | trim, collapse repeated spaces | `Enter a valid address.` |
| `notes` | Notes | No | text | If present: up to 1000 characters | preserve line breaks, trim leading/trailing whitespace | `Notes cannot be longer than 1000 characters.` |

## 5. Regex and parsing reference

| Field ID | Pattern / parser |
| --- | --- |
| `registrationNumber` | `^[A-Z0-9 -]{2,15}$` after normalization |
| `vin` | `^[A-HJ-NPR-Z0-9]{17}$` |
| `price` | Decimal parser, max 2 fractional digits |
| `mileage` | Integer parser only |
| `year` | Integer parser only |
| `doorCount` | Integer parser only |

## 6. Cross-field business validation

| Rule ID | Condition | Result |
| --- | --- | --- |
| `CF-1` | `fuelType = electric` and `transmission != automatic` | Block save with `Electric cars must use Automatic transmission.` |
| `CF-2` | Session title fields missing or invalid | Do not generate or update the final session title |
| `CF-3` | Any required mapping field invalid | Keep Parts 2-5 locked |

## 7. Save behavior

| Scenario | Behavior |
| --- | --- |
| Required fields invalid | Save draft state locally if needed, but keep downstream Parts locked |
| Optional field empty | Save as `null` or empty string according to implementation standard |
| Optional field invalid | Show inline error and do not persist the invalid value as final normalized value |
| Required fields valid | Persist normalized Part 1 payload and unlock Parts 2-5 |

## 8. Suggested normalized payload shape

```json
{
  "price": 24999.99,
  "make": "Toyota",
  "model": "Corolla",
  "year": 2020,
  "registrationNumber": "WX 1234A",
  "vin": "SB1K93BE60E123456",
  "mileage": 135000,
  "fuelType": "hybrid",
  "transmission": "automatic",
  "drive": "2wd",
  "color": "Silver",
  "bodyType": "hatchback",
  "doorCount": 5,
  "address": "Warsaw, Poland",
  "notes": "Seller claims full service history."
}
```

## 9. English error copy set

| Field ID | Error copy |
| --- | --- |
| `make` | `Enter the car make.` |
| `model` | `Enter the car model.` |
| `year` | `Enter a valid production year.` |
| `registrationNumber` | `Enter a valid registration number.` |
| `vin` | `VIN must contain exactly 17 letters and digits without I, O or Q.` |
| `mileage` | `Enter a valid mileage.` |
| `fuelType` | `Select the fuel type.` |
| `transmission` | `Select the transmission type.` |
| `drive` | `Select the drive type.` |
| `bodyType` | `Select the body type.` |
| `doorCount` | `Enter a valid number of doors.` |
| `price` | `Enter a valid price greater than or equal to 0.` |
| `address` | `Enter a valid address.` |
| `notes` | `Notes cannot be longer than 1000 characters.` |
| `crossField.electricTransmission` | `Electric cars must use Automatic transmission.` |