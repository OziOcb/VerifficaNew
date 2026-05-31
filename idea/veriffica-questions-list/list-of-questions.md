# Used Car Checklist / Lista kontrolna używanego samochodu

## Part 1 — Info about the car
Forma do wypełnienia w której użytkownik wpisywać będzie podstawowe dane pojazdu
- Price
- Make (required, part of the title)
- Model (required, part of the title)
- Year of production (part of the title)
- Registration number (part of the title)
- VIN number
- Mileage
- Fuel type: (dropdown, required, affects the questions)
    - Petrol
    - Diesel
    - Hybrid
    - Electric
- Transmission: (dropdown, required, affects the questions)
    - Manual
    - Automatic
- Drive: (dropdown, required, affects the questions)
    - 2WD
    - 4WD
- Color
- Body type: (dropdown, required, affects the questions)
    - Sedan
    - Hatchback
    - SUV
    - Coupe
    - Convertible
    - Van
    - Pickup
    - Other
- No of doors
- Address
- Notes

## Normalized visibility model for Parts 2-5

- Primary visibility formula:
  - `Visible groups = Base + selected Fuel type + selected Transmission + selected Drive + selected Body type`
- A group can belong to more than one additive bucket when the same questions are valid for multiple configurations, for example `Petrol / Diesel / Hybrid`.
- Runtime flags should remain only where Part 1 does not carry enough information to decide visibility.
- Runtime-only exceptions in the current question set:
  - `chargingPortEquipped`
  - `evBatteryDocsAvailable`
  - `turboEquipped`
  - `mechanicalCompressorEquipped`
  - `importedFromEU`
- Empty additive buckets in the current source list:
  - `2WD`
  - `Sedan`
  - `Hatchback`
  - `Coupe`
  - `Other`

## Part 2 — At a standstill / Na postoju

### Base

#### Car Body
- Corrosion, blistering
  - Bonnet
  - Boot lid
  - Fender
  - Gasket and window areas
  - Body dents
  - Fuel filler area
  - Hinges connections
  - Door edges
  - Handles
  - Engine compartment
  - Floor (moisture)
  - Windshield
  - Floor, under back seats
- traces of repairs / use
  - Paint discoloration
  - Paint cracking
  - Paint swelling
  - Visible lumps and dirt under the paint
  - Traces of paint/polishing paste on the seals
  - Badly matched body parts
  - Moldings curves or uneven body lines
  - Noticeable welds on the car body, bumpers etc.
  - Different production dates, different glass manufacturers
  - Different production dates, different lamp manufacturers
  - Scratches on the windshield under the wipers
  - Damages on the windshields (chips, cracks)

#### Engine compartment and engine - structure and accident traces
- Bumpers and fenders
  - Damaged mounting bolts (paint scratches on the bolt head)
  - Different fastening elements
- Side members
  - Rust
  - Traces of repairs
- Welds
  - Asymmetrical welds

#### Front suspension
##### Suspension condition
- signs of corrosion of the suspension
- cracked rubber parts *6
- Slow return to vertical when force is applied over the shock absorber *7

#### Tires
##### Tires condition
- Wear less than 1.6mm or TW1 point
- Uneven tire wear *8
- Bubbles, cracks, scratches, etc.

#### Car interior
##### Wear indicating high mileage
- Heavily worn driver's seat upholstery
- Sagging driver seat
- Broken driver's seat springs
- Visible wipe of the driver's seat from the door side
- Both sets of keys worn out
- Driver's belt tensioner springs are weak
- Worn steering wheel
- Steering wheel in better condition than the interior of the car *9
- Worn marks on light switches
- Worn pedal covers or new pedal covers *9
- Worn or noticeably new stick shift *9
- Shifter guard cracked
- Cracked shifters sound deadening

##### The condition of the upholstery
- Water marks *10
- Moisture *10
- Musty smell *10
- Burnt upholstery *11
- Dirty ashtray *11

##### The electrics
- Interior and exterior lighting is not working
- Air vents are not working
- Central locking not working (if applicable)
- Electric mirrors not working (if applicable)
- Radio not working (if applicable)
- Electric windows not working (if applicable)
- Sunroof not working (if applicable)

##### Steering system
- Backlash when turning the steering wheel
- a knock while pulling and pushing the steering wheel diagonally from right to left *12
- a knock coming from the bottom of the car when shaking the steering wheel rapidly left and right *12

### Fuel: Petrol / Diesel / Hybrid

#### The condition of the coolant in the expansion tank and engine
- Lack of clarity *1
- Smell of exhaust fumes *1
- Black or brown grease on the edges of the tank *1
- Foaming *1
- Leaks *2

#### Oil condition
- Leakage around the oil filler wrench *3
- Leaks around the engine block *3
- Leaks around the motor head *3
- Leaks around the oil drain *3
- Leaks around the oil pump *3
- Leaks around the oil filter *3
- Leaks around the turbocharger (if applicable) *3
- Water marks on the oil dipstick *1
- Sludge on the oil plug *1
- Metal filings on the oil indicator *4

#### Belts and pulleys
- Frayed belts
- Cracked belts
- Deflected belts (about 1 cm or less)
- Deformation of pulleys

#### Exhaust system
##### Exhaust system condition
- Traces of corrosion

### Fuel: Petrol / Hybrid

#### Spark plugs condition
- Black coating
- Traces of soot

### Fuel: Diesel

#### Diesel fuel system
- Diesel fuel filter housing leaks *37
- Traces of metal filings around the high-pressure pump *38
- Wet injectors or smell of diesel fuel in the engine bay *39
- Cracked or hardened return fuel hoses *39

#### Diesel cold-engine checks
- Glow plug indicator does not behave normally after turning the ignition on *40
- Excessive waxy deposits around the fuel filter in cold weather *41

### Fuel: Hybrid / Electric

#### High-voltage battery and electrical system
- Damaged orange high-voltage cables or missing protective covers *42
- Warning labels missing in the engine bay or service access areas
- Traces of impact, dents or deformation near the traction battery housing *43
- Evidence of moisture, corrosion or dirt around high-voltage connectors *42
- Strong chemical smell near the battery area after opening the car *43

### Fuel: Hybrid / Electric with runtime flag `chargingPortEquipped`

#### Charging port and charging accessories
- Charging port flap damaged or does not close properly
- Visible corrosion, burns or bent pins in the charging port *44
- Charging cable insulation damaged or plug casing cracked *44
- Portable charger missing or obviously damaged (if included in the sale)

### Fuel: Petrol / Diesel / Hybrid with runtime flag `mechanicalCompressorEquipped`

#### Mechanical turbocharger
- Broken compressor belt *5

### Transmission: Automatic

#### Automatic transmission visual inspection
- Transmission fluid leak under the gearbox area *45
- Burnt smell around the transmission fluid dipstick or filler area (if accessible) *45
- Selector positions on the lever are worn or not clearly engaging *46

### Drive: 4WD

#### 4WD driveline condition
- Leaks around transfer case or rear differential *47
- Torn driveshaft or axle rubber boots *48
- Noticeable play in the prop shaft when checked by hand *47

### Body type: Convertible

#### Convertible roof and seals
- Roof fabric or panels damaged, cracked or torn
- Moisture marks near roof seals or top edge of windshield *10
- Roof opens or closes unevenly (if test is possible) *49
- Side windows do not align with roof seals *49

### Body type: SUV

#### SUV / raised body checks
- Cracked or damaged plastic underbody covers
- Damaged side steps or rocker area from off-road impacts
- Uneven wear or damage on lower bumpers and splash shields

### Body type: Van

#### Van body and cargo area
- Sliding door rollers noisy, sticking or misaligned *50
- Rear cargo floor bent, cracked or patched
- Signs of water leaks in the cargo area *10
- Bulkhead or cargo tie-down points visibly damaged

### Body type: Pickup

#### Pickup load bed and tailgate
- Load bed floor heavily bent or patched
- Tailgate cables, hinges or latches damaged *51
- Corrosion under bed liner or around wheel arches
- Bed and cabin alignment visibly uneven *52

---

## Part 3 — Starting the engine / Uruchamianie silnika

### Base

#### Car interior
##### Steering system
- A whistling sound is heard when the wheels turn fully *18
- Vibration of plastic parts in the cabin *19

### Fuel: Petrol / Diesel / Hybrid

#### Ignition
##### Engine start-up
- Before starting the engine, the indicator lamps are off when the key is turned
- The engine starts more than 3 s after turning the key *13
- Rasp and metal noises when turning the key *14
- No start-up after turning the key *15
- indicator lamps on after starting the engine *16
- Rough idling *17

#### Engine compartment and engine
##### Engine condition
- After removing the oil plug and/or dipstick, visible oil splashes and smoke from the engine *4

#### Exhaust system
- Smoke in the engine compartment or a strong smell of exhaust gases *20
- Oily and black deposits on the tip of the exhaust pipe *21
- Blue exhaust *4
- White exhaust *1

### Fuel: Petrol / Hybrid

#### Exhaust system
- Black exhaust from gasoline engine (not applicable to diesel engines) *22

### Fuel: Diesel

#### Ignition
##### Diesel start-up behavior
- Excessive smoke immediately after cold start *53
- Engine shakes strongly for the first seconds after starting *54
- Glow plug or engine management warning remains on after start *40

### Fuel: Hybrid / Electric

#### Ignition
##### Hybrid / electric power-up checks
- The car does not enter READY / drive-ready mode after start procedure *55
- High-voltage system warning light remains on after power-up *42
- Main display shows charging system, battery or isolation fault messages *42
- Unusually loud cooling fan starts immediately after power-up on a cold car *43

### Transmission: Automatic

#### Car interior
##### Automatic selector engagement at standstill
- Delay or strong jerk when shifting from P to D or R with the brake applied *46
- Selector cannot be moved smoothly through all positions *46

---

## Part 4 — Test drive / Jazda próbna

### Base

#### Suspension
##### Suspension responses
- Rear suspension knocks *25
- Swaying on bumps *26
- Lack of traction after braking *27

#### Steering system
##### Steering system responses
- Drift after releasing the steering wheel *26
- Loss of traction on the turns *27

#### Other phenomena
- Whining as speed increases *28

#### Brakes
##### Braking system responses
- Excessive brake pedal travel *29
- Brake not responding *30
- Brake heating *31
- Steering wheel and brake pedal tremble when braking *32
- Springing and deep pressure on the brake pedal *33
- Wheel lock when braking with ABS *34
- Drift when braking *35

### Transmission: Manual

#### Gearbox and clutch
##### Gearbox and clutch condition
- The car starts in third gear *23
- Clutch catches low or high
- Gear stick shakes *24
- Imprecise gears *24
- Hearable creaks *24

### Transmission: Automatic

#### Automatic transmission operation
- Delay when moving off after selecting D or R *46
- Noticeable jerks during upshifts or downshifts *46
- Gear hunting or frequent unnecessary shifts at steady speed *46
- Transmission slips under acceleration (engine revs rise but speed does not) *45

### Fuel: Diesel

#### Diesel operation under load
- Noticeable loss of power above medium speed *56
- Excessive black smoke under acceleration *22
- DPF / emissions warning appears during the drive *56

### Fuel: Hybrid / Electric

#### Hybrid / electric drive behavior
- Jerky transition between regenerative braking and friction braking *57
- Noticeable vibration or humming from the battery area during acceleration *43
- Sudden drop of available power shown on the dashboard *55
- State-of-charge drops unusually fast during a short drive *58

### Fuel: Petrol / Diesel / Hybrid with runtime flag `turboEquipped`

#### Turbocharger
##### Exhaust turbocharger
- Increased oil consumption and emissions from the exhaust system *36
- Loud operation and metallic sound *36
- Turbocharger only turns on above a certain speed *36

### Fuel: Petrol / Diesel / Hybrid with runtime flag `mechanicalCompressorEquipped`

#### Mechanical turbocharger
- Compressor whistling excessively loud as engine speed increases *36

### Drive: 4WD

#### 4WD system operation
##### Drivetrain responses
- Binding, hopping or heavy resistance during slow full-lock turns on dry ground *59
- Knocking or vibration from the center tunnel during acceleration *47
- 4WD warning light appears during the drive *59

### Body type: Convertible

#### Convertible body noise and seal behavior
##### Roof responses during the drive
- Excessive wind noise around the roof seals at city speed *49
- Water leak noise, rattles or roof frame knocks on bumps *49

---

## Part 5 — Documents / Numer nadwozia i dokumenty pojazdu

### Base

#### Chassis numbers (VIN)
##### VIN number compliance
- The car has decryptable VINs
- The VIN is 17 characters long
- VIN numbers on the rating plate are consistent with those stamped on the wheel arch or in the trunk
- After identification, the VIN data matches the version, equipment, car type, etc.

#### Service booklet
##### Desired information
- Bills and invoices for all repairs
- Mileage in the booklet matches the odometer reading
- Information on servicing the car at an authorized service station throughout its lifetime

#### Registration certificate
##### Compliance of the data in the documents with the actual data
- Details of the owner and/or co-owner
- Car data (chassis number, engine number etc.)

#### Vehicle card
##### Content
- Confirmation of the car's history

### Fuel: Hybrid / Electric with runtime flag `evBatteryDocsAvailable`

#### Charging and traction battery documents
##### Necessary documents
- Battery warranty or battery health report (if available from the seller)
- Charging cable(s) and charging adapter(s) included in the sale
- Documentation for replaced traction battery modules (if applicable)
- Documentation for high-voltage system service campaigns or recalls (if applicable)

### Runtime flag `importedFromEU`

#### Cars imported from the EU
##### Documents compulsory for the seller
- Sale and purchase agreement
- Vehicle card
- Confirmation of the deregistration of the car abroad

##### Documents non-compulsory for the seller
- Certificate of a positive result of the technical examination
- Confirmation of excise duty payment
- Confirmation of VAT payment
- Confirmation of recycling fee payment
- Translations of the documents in a foreign language

---

## EXPLANATIONS / WYJAŚNIENIA
1. Damaged cylinder head, cylinder head gasket or engine block
2. Coolant leakage due to damaged rubber hoses, radiator, water pump, cylinder head or engine block
3. Leaking seals, need to be replaced
4. Worn drive unit
5. Turbocharger for replacement
6. Replacement needed
7. Damaged shock absorber
8. Bad chassis geometry or bad wheel alignment
9. Indicates a replacement of a worn element due to damage or hide the signs of wear
10. Car leaking or flooded
11. The owner was a smoker
12. Steering system requires repair
13. Damaged / discharged battery or damaged alternator
14. Damaged starter
15. Starter, alternator or battery damaged
16. Systems indicated by the check lights damaged
17. Damage to the lambda probe
18. Worn power steering belts or pulleys
19. Damaged engine cushions
20. Leaking at the front of the exhaust system
21. Too much oil in the combustion chamber - damaged seals, valves or rings
22. Fuel system not adjusted - carburetor or fuel injectors
23. Worn clutch disc or poor contact pressure
24. Gearbox damaged
25. Bad stabilizer link or damaged rocker arm, rubber bushing, or rocker arm pin
26. Damaged control arm or tie rod
27. Worn shock absorbers, damaged steering rods or suspension springs
28. Defective bearings or wrong tires
29. Brake fluid leakage
30. Braking system badly damaged
31. Seized brakes
32. Broken brake discs or drums, poorly fitting rims or worn bearings
33. Air in the brake system
34. ABS system damaged
35. Bad brake linings or discs or damaged steering system components
36. Damaged turbocharger
37. Fuel filter housing or seals leaking
38. High-pressure fuel pump may be wearing internally
39. Fuel system leakage, requires repair
40. Glow plug system or engine management fault
41. Fuel contamination or poor diesel maintenance
42. High-voltage electrical system requires specialist inspection
43. Traction battery housing or battery cooling system may be damaged
44. Charging system requires repair and may be unsafe to use
45. Automatic transmission wear or fluid condition issue
46. Automatic selector or gearbox control issue
47. Transfer case, differential or prop shaft wear
48. Driveshaft joint or axle boot replacement needed
49. Convertible roof mechanism or sealing requires repair
50. Sliding door mechanism worn or misaligned
51. Tailgate hardware damaged and may fail under load
52. Pickup body may have structural or accident-related damage
53. Combustion quality, glow plugs or injector system issue
54. Engine mount, injector or compression issue
55. Hybrid / EV drive system fault, specialist diagnosis required
56. Diesel emissions or turbo / intake issue
57. Brake blending or regenerative braking calibration issue
58. Traction battery condition may be degraded
59. 4WD / AWD system fault or drivetrain wind-up issue
