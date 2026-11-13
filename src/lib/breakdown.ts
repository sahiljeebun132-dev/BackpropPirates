/** Roadside help: what to do when the car stops.
 *
 * Three rules shaped every word below.
 *
 * 1. Safety before fixing. The app asks whether anyone is hurt and where the
 *    car is standing before it will show a single repair step. A puncture on
 *    the hard shoulder of the M1 is not a tyre problem, it is a danger of
 *    being hit, and the right answer there is to leave the wheel alone.
 *
 * 2. Nothing model-specific is invented. Procedures genuinely differ between
 *    cars — jack points, whether there is a spare at all, where the battery
 *    sits — and no free database publishes them. Every guide says plainly
 *    where the owner's manual is the only safe authority.
 *
 * 3. An honest stop. Each guide carries the conditions under which the right
 *    move is to stop and call someone, and those are shown before the steps,
 *    not buried after them.
 *
 * Mauritius drives on the left, so passing traffic is on the driver's side
 * and the kerb is on the passenger's. Every instruction about getting out of
 * a car reflects that.
 */

export type Vehicle = 'car' | 'motorcycle'

export const VEHICLE_LABEL: Record<Vehicle, string> = {
  car: 'Car or van',
  motorcycle: 'Motorcycle or scooter',
}

export type Powertrain = 'petrol-diesel' | 'hybrid' | 'electric' | 'unsure'

export type StoppedWhere = 'motorway' | 'main-road' | 'side-road' | 'safe-spot'

export const WHERE_LABEL: Record<StoppedWhere, string> = {
  motorway: 'On the motorway (M1, M2, M3)',
  'main-road': 'On a main road, traffic passing close',
  'side-road': 'On a quiet side road',
  'safe-spot': 'Fully off the road, car park or driveway',
}

/** The same thing phrased to sit mid-sentence. Lowercasing the label instead
 *  turned the road names into "m1, m2, m3". */
export const WHERE_PHRASE: Record<StoppedWhere, string> = {
  motorway: 'on the motorway',
  'main-road': 'on a main road with traffic passing close',
  'side-road': 'on a quiet side road',
  'safe-spot': 'fully off the road',
}

export const POWERTRAIN_LABEL: Record<Powertrain, string> = {
  'petrol-diesel': 'Petrol or diesel',
  hybrid: 'Hybrid',
  electric: 'Electric',
  unsure: 'Not sure',
}

/** Can a repair reasonably be attempted where the car is standing? */
export function canWorkHere(where: StoppedWhere, vehicle: Vehicle = 'car'): boolean {
  if (vehicle === 'motorcycle') {
    // A higher bar for a bike. The rider has no metal around them, and a
    // motorcycle has to be held upright to be worked on at all, so a quiet
    // side road is not good enough.
    return where === 'safe-spot'
  }
  return where === 'safe-spot' || where === 'side-road'
}

export type Step = {
  text: string
  /** Shown alongside the step in a warning tone. */
  caution?: string
}

export type Guide = {
  id: string
  /** Which machine this guide is for. Nothing is shared between the two
   *  sets: a bike puncture is not a car puncture with different wording, and
   *  handing car steps to a rider is the exact mistake this app exists to
   *  avoid. */
  vehicle: Vehicle
  label: string
  /** One line, so someone scanning in a hurry can pick the right one. */
  blurb: string
  /** Read before touching anything. */
  before: string[]
  youNeed?: string[]
  steps: Step[]
  /** Conditions where the honest answer is to stop. Shown above the steps. */
  stopAndCall: string[]
  /** What only the manual can tell them. */
  manualSays?: string
}

export const GUIDES: Guide[] = [
  {
    id: 'flat-tyre',
    vehicle: 'car',
    label: 'Flat tyre',
    blurb: 'A puncture, or the tyre pressure warning came on',
    before: [
      'The car must be on firm, level ground, out of the traffic lane, handbrake on and in gear or park.',
      'Everyone out through the kerb-side doors and behind a barrier or well off the road. Not sitting in the car, and not standing on the traffic side.',
      'Hazard lights on. If you carry a warning triangle, put it well back along the road, far enough that a driver coming round the last bend still has time to slow.',
    ],
    youNeed: [
      'The spare or the sealant kit, usually under the boot floor',
      'Jack and wheel brace',
      'The locking wheel-nut key if your car has one',
    ],
    stopAndCall: [
      'You are on the motorway, or traffic is passing close enough to feel it. Changing a wheel on the traffic side is one of the most dangerous things a driver can do.',
      'The ground is soft, loose or sloping. A jack can sink or slip.',
      'The nuts will not move, or the locking key is missing.',
      'The tyre is shredded, the sidewall is torn or the wheel itself is damaged.',
      'It is dark and you are not confident you can be seen.',
    ],
    steps: [
      {
        text: 'Open the boot floor and see what you actually have. Many cars built since about 2010 carry a sealant kit instead of a spare wheel.',
        caution: 'A sealant kit seals small tread punctures only. It will not fix a sidewall tear or a large gash.',
      },
      {
        text: 'With the wheel still on the ground, loosen each nut about a quarter turn. The ground stops the wheel spinning while you push.',
      },
      {
        text: 'Find the jack point. It is a reinforced pad under the sill, usually marked with a notch, arrow or triangle in the trim.',
        caution: 'Jacking anywhere else can crush the sill or let the car drop. If you cannot find the mark, stop and call.',
      },
      { text: 'Raise the car until the flat tyre is just clear of the ground, no higher.' },
      {
        text: 'Take the nuts off, swap the wheel, and start all the nuts by hand before tightening any of them.',
        caution: 'Never put any part of yourself under a car held up by a jack.',
      },
      {
        text: 'Tighten in a star pattern, opposite nut each time, rather than going round the circle. Then lower the car and tighten firmly in the same order.',
      },
      {
        text: 'If the spare is a narrow space-saver, check the sticker on it. These are usually limited to about 80 km/h and a short distance.',
      },
      { text: 'Get the puncture repaired or the tyre replaced soon. A spare is a way home, not a fix.' },
    ],
    manualSays: 'Where the jack points are, and whether your car carries a spare or a sealant kit.',
  },

  {
    id: 'wont-start',
    vehicle: 'car',
    label: 'It will not start',
    blurb: 'Dead, clicking, or turning over without firing',
    before: [
      'Make sure the car is in park or neutral with the handbrake on before anything else.',
      'What you hear when you turn the key tells you most of it, so listen first.',
    ],
    youNeed: ['Jump leads and a second car, or a jump pack'],
    stopAndCall: [
      'Your car is hybrid or electric and the problem is with the high-voltage system. The orange cables carry enough voltage to kill. Never touch them, and never jump from them.',
      'The battery case is cracked, bulging or leaking, or you smell rotten eggs. That is escaping gas or acid.',
      'The engine turns over normally but will not fire. That is not the battery, and guessing further costs you time.',
      'You are on a motorway or in a live traffic lane.',
    ],
    steps: [
      {
        text: 'Nothing at all, no lights, no click: the battery is flat or a terminal is loose. Check both terminals are tight and clean before anything else.',
      },
      {
        text: 'A rapid clicking: the battery has enough for the lights but not enough to turn the starter. A jumpstart is worth trying.',
      },
      {
        text: 'It turns over steadily but never fires: the battery is fine. This is fuel, spark or an immobiliser, and it is a garage job.',
      },
      {
        text: 'To jumpstart, park the good car close but not touching, both engines off, both handbrakes on.',
      },
      {
        text: 'Red clamp to the flat battery positive, other red to the good battery positive. Black clamp to the good battery negative.',
      },
      {
        text: 'The last black clamp goes on bare metal on the engine block of the flat car, away from its battery. Not on the flat battery negative.',
        caution: 'A charging battery vents hydrogen. The last connection is the one that sparks, so it must be made away from the battery.',
      },
      { text: 'Start the good car, let it run two or three minutes, then try the flat one.' },
      {
        text: 'Once it starts, drive for at least twenty minutes or the battery will be flat again. Remove the leads in the reverse order.',
      },
      {
        text: 'If it goes flat again within a day or two, the battery or the charging system needs replacing, not recharging.',
      },
    ],
    manualSays: 'Where your battery is. On a good number of cars it is not under the bonnet, and some provide a dedicated jump terminal instead.',
  },

  {
    id: 'overheating',
    vehicle: 'car',
    label: 'Overheating',
    blurb: 'Temperature gauge climbing, warning light, or steam',
    before: [
      'Turn the air conditioning off and the heater to full hot with the fan high. It feels wrong, but it pulls heat out of the engine.',
      'Pull over as soon as it is safe and switch the engine off. Every extra minute running risks a warped head and a bill in the tens of thousands of rupees.',
    ],
    stopAndCall: [
      'There is steam, spray, or a sweet smell. The system is pressurised and the coolant is well above boiling.',
      'There is a puddle under the car, or the level drops again soon after topping up. Something has failed.',
      'The oil warning light comes on as well.',
      'The temperature climbs again within a few minutes of setting off.',
    ],
    steps: [
      {
        text: 'Engine off. Leave the bonnet shut if you can see steam, and wait.',
      },
      {
        text: 'Never open the radiator cap or the expansion tank while the engine is hot.',
        caution: 'The coolant is under pressure and far above 100 degrees. Opening it releases a scalding spray. Wait at least thirty minutes, and longer if you can.',
      },
      {
        text: 'Once it is cool enough to rest your hand on the tank, check the level against the minimum and maximum marks on the side.',
      },
      {
        text: 'If it is low, top up with the right coolant. Clean water will get you home in an emergency, but it dilutes the protection and needs correcting soon.',
      },
      {
        text: 'Start up and watch the gauge. If it climbs again, switch off. Driving an overheating engine is how a small repair becomes a new engine.',
      },
    ],
    manualSays: 'Which coolant your engine takes. Mixing types can turn the coolant to sludge.',
  },

  {
    id: 'warning-light',
    vehicle: 'car',
    label: 'A warning light came on',
    blurb: 'Work out whether to stop now or book it in',
    before: [
      'Colour tells you the urgency, and that part is standard across nearly every car.',
    ],
    stopAndCall: [
      'A red light is on and you cannot get safely off the road.',
      'The oil pressure light is on. Stop the engine. Driving on it can destroy the engine within minutes.',
      'The brake warning is on and the pedal feels long, soft or the car pulls when braking.',
    ],
    steps: [
      {
        text: 'Red means stop as soon as it is safe. Oil pressure, temperature, brakes, charging and airbag all use red.',
      },
      {
        text: 'The oil can symbol in red is not a low-oil reminder. It means the engine has lost oil pressure. Switch off immediately.',
        caution: 'This is the one light where carrying on, even a short distance, can write the engine off.',
      },
      {
        text: 'Amber means get it looked at soon. Engine management, ABS, tyre pressure and glow plugs are usually amber, and the car is usually drivable gently.',
      },
      {
        text: 'An engine light that is flashing rather than steady means a misfire happening right now. Ease off, keep the revs down and get it seen.',
        caution: 'A sustained misfire can destroy the catalytic converter, which is an expensive part.',
      },
      { text: 'Green and blue are information, not faults.' },
      {
        text: 'If a red light came on and then went out, it still happened. Mention it when the car is next serviced.',
      },
    ],
    manualSays: 'The exact symbol chart for your car. Manufacturers do vary, and a few use their own icons.',
  },

  {
    id: 'oil-check',
    vehicle: 'car',
    label: 'Check the oil',
    blurb: 'How to read the dipstick properly',
    before: [
      'Engine off, car on level ground, and wait five to ten minutes after running so the oil drains back down.',
    ],
    stopAndCall: [
      'The red oil pressure light is on. That is not a level problem. Stop the engine and call.',
      'The oil is milky or looks like coffee with milk. That is coolant getting into the oil, and it needs a garage.',
    ],
    steps: [
      { text: 'Pull the dipstick out, wipe it clean, push it all the way back in, then pull it out again. The first reading is always wrong.' },
      { text: 'Read where the oil film ends. It should sit between the minimum and maximum marks.' },
      {
        text: 'If it is below minimum, add a little at a time and re-check. Give it a minute to drain down between top-ups.',
        caution: 'Over-filling is its own problem: too much oil gets whipped into foam and stops protecting the engine.',
      },
      { text: 'Oil that is gritty, or smells burnt, or is well past its service interval, needs changing rather than topping up.' },
    ],
    manualSays: 'The oil grade your engine needs. Putting in the wrong viscosity does real harm over time.',
  },

  {
    id: 'out-of-fuel',
    vehicle: 'car',
    label: 'Out of fuel',
    blurb: 'Ran dry, or the gauge is on empty and it cut out',
    before: ['Get the car as far off the road as it will roll, and the people well clear of traffic.'],
    stopAndCall: [
      'The car is diesel. Running a diesel dry usually draws air into the fuel system, and most need bleeding before they will restart. That is a garage job.',
      'You are on a motorway. Walking on one is illegal and extremely dangerous.',
    ],
    steps: [
      { text: 'Stop cranking. Turning the engine over on an empty tank wears the starter and can damage the fuel pump, which relies on fuel to stay cool.' },
      { text: 'If it is petrol and someone can bring you fuel, put in at least five litres before trying again, and expect a few seconds of cranking.' },
      {
        text: 'Think hard before walking to a filling station. On a Mauritian main road after dark, walking is the more dangerous option.',
        caution: 'Half of everyone hurt on these roads is on foot or on two wheels. Waiting in a safe place beats walking.',
      },
    ],
  },

  {
    id: 'smoke-or-smell',
    vehicle: 'car',
    label: 'Smoke, burning or a fuel smell',
    blurb: 'Stop reading and get everyone out',
    before: [
      'This one has no repair steps. Fire in a car spreads in seconds and the fuel tank is part of the car.',
    ],
    stopAndCall: [
      'Always. Get everyone out and well away, at least a hundred paces, upwind, and behind a barrier if there is one.',
      'Call the fire service on 115, and 999 if the road is blocked.',
    ],
    steps: [
      {
        text: 'Do not open the bonnet if you think there is fire behind it.',
        caution: 'Lifting the bonnet feeds the fire a rush of air. Leave it shut.',
      },
      { text: 'Leave everything in the car. Nothing in it is worth going back for.' },
      { text: 'Keep other people back too. Tyres and struts can burst.' },
    ],
  },

  // ----------------------------------------------------------- motorcycles
  // Half of everyone hurt on Mauritian roads is on two wheels or on foot, so
  // a roadside library covering only cars was answering the smaller half of
  // the problem. None of this is car advice reworded. A bike puncture, a
  // chain and a dead headlight after dark are their own failures with their
  // own answers, and the honest answer is "stop and call" more often than it
  // is for a car, because a rider has nothing around them.

  {
    id: 'moto-puncture',
    vehicle: 'motorcycle',
    label: 'Puncture or flat tyre',
    blurb: 'A soft tyre, a wobble, or you can hear it going down',
    before: [
      'Slow down gently and do not brake hard. A flat front especially will push the bars where you do not want them.',
      'Get fully off the carriageway before you look at anything. Push the bike; do not ride it even a short way on a flat.',
      'Keep your helmet on while you are anywhere near moving traffic.',
    ],
    stopAndCall: [
      'You are on the motorway or a main road. There is nowhere safe to hold a bike upright beside fast traffic.',
      'The tyre has a tube. Most spoked wheels do, and a plug kit cannot fix a tube \u2014 the wheel has to come off, which is a workshop job.',
      'The damage is in the sidewall or the shoulder, or the tyre came off the rim. No roadside repair is safe on any of those.',
      'It is the front tyre and you are not completely certain of the repair. A front letting go at speed rarely ends well.',
      'It is dark, or it is raining.',
    ],
    youNeed: [
      'A tubeless plug kit and a pump or CO2, if you carry one',
      'The pressure figure from the chain guard or the manual',
    ],
    steps: [
      {
        text: 'Work out whether the wheel is tubeless or tubed. Cast alloy wheels are usually tubeless; spoked wheels usually run a tube.',
        caution: 'If you cannot tell, treat it as tubed and call. A plug in a tubed tyre does nothing at all.',
      },
      {
        text: 'Find what went in. A nail or screw straight into the tread is the only case worth plugging.',
        caution: 'Leave it in place until you are ready to plug, or the rest of the air goes with it.',
      },
      {
        text: 'If it is a tread puncture in a tubeless tyre and you have a kit, follow the kit instructions exactly: ream, plug, trim, inflate.',
      },
      {
        text: 'Inflate to the pressure printed on the bike, not by feel, and check it holds for a few minutes.',
      },
      {
        text: 'Ride slowly and directly to a tyre shop. A plug gets you there; it is not a repair.',
        caution: 'No motorway, no overtaking, and stay well under 60 km/h.',
      },
    ],
    manualSays: 'Your tyre pressures, and whether your wheels run tubes. Both are on the bike or in the manual, and guessing either is how a roadside repair goes wrong.',
  },

  {
    id: 'moto-wont-start',
    vehicle: 'motorcycle',
    label: 'It will not start',
    blurb: 'Dead, clicking, or turning over without firing',
    before: [
      'Get the bike off the carriageway first, even if that means pushing it.',
      'Most of the time this is one of five small things, and all of them are free to check.',
    ],
    stopAndCall: [
      'You can smell petrol. Get away from the bike and do not touch the starter.',
      'It cut out while you were riding rather than failing to start. That is a different fault, and usually electrical.',
      'You are on a main road or the motorway.',
    ],
    steps: [
      {
        text: 'Kill switch. Check the red switch by your right thumb is in the run position. It is the commonest cause and the most embarrassing.',
      },
      {
        text: 'Side stand. Almost every bike refuses to start, or cuts out, with the stand down and a gear engaged. Put it up.',
      },
      {
        text: 'Neutral, or clutch in. Find neutral and try again. If the green light is out, pull the clutch fully and try that.',
      },
      {
        text: 'Fuel. Look in the tank rather than trusting the gauge. On an older carburettor bike, check the tap is on and try the reserve position.',
      },
      {
        text: 'Battery. Turn the key and watch the headlight. Bright and steady suggests the battery is fine; dim, or a rapid clicking, says it is not.',
        caution: 'Do not jump a motorcycle from a running car. A car charging system can push far more current than a small bike battery or its electronics are built for.',
      },
      {
        text: 'If the battery is flat and the bike has a kick start, use it. Otherwise this is a call.',
        caution: 'Never bump-start on a road with traffic, and never try it on a scooter or any automatic.',
      },
    ],
    manualSays: 'Where the fuse box is and which fuse is which. One blown fuse looks exactly like a dead bike.',
  },

  {
    id: 'moto-chain',
    vehicle: 'motorcycle',
    label: 'Chain trouble',
    blurb: 'Slapping, clunking, jumping, or it has come off',
    before: [
      'If the chain is off, or you can hear it slapping, stop riding. A chain that comes off at speed can lock the rear wheel.',
      'Engine off and in neutral before your hands go anywhere near it.',
    ],
    stopAndCall: [
      'The chain has snapped, or it is wrapped around the sprocket. That is a recovery, not a roadside fix.',
      'The rear wheel will not turn freely by hand.',
      'The chain is slack enough to touch the swingarm, or you can pull it off the back of the rear sprocket by more than about half a tooth.',
      'You have no tools. Chain tension is set to a figure in the manual with the bike loaded, and guessing it wrong is worse than leaving it alone.',
    ],
    steps: [
      {
        text: 'Look along the whole chain with the bike in neutral, rolling it slowly forwards.',
        caution: 'Roll it forwards only, and keep your fingers well away from the sprockets.',
      },
      {
        text: 'Look for a tight spot, a kinked link, or links gone orange with rust. Any of those means the chain is finished, not loose.',
      },
      {
        text: 'If it has simply come off and chain and sprockets look undamaged, it can sometimes be walked back on by hand with the wheel rolled slowly forwards.',
        caution: 'Engine off. Never with the engine running, and never in gear.',
      },
      {
        text: 'Even if it goes back on, ride gently and straight to a garage. A chain that jumped once had a reason, usually tension or a worn sprocket.',
      },
    ],
    manualSays: 'The free play your chain should have, measured at the right point with the right load. It differs between bikes and it is the one number you cannot sensibly guess.',
  },

  {
    id: 'moto-dropped',
    vehicle: 'motorcycle',
    label: 'You dropped it, or had a low-speed fall',
    blurb: 'What to check before you ride on',
    before: [
      'Check yourself before the bike. Adrenaline hides a lot, and wrists, collarbones and ankles are what usually go in a low-speed drop.',
      'If anyone is hurt at all, that comes first. Ambulance 114.',
    ],
    stopAndCall: [
      'Petrol is leaking, or you can smell it strongly. Get away from the bike and call.',
      'The forks look twisted, the front wheel does not line up with the bars, or the bars are bent.',
      'The front brake lever pulls back to the bar, or either brake does not bite.',
      'A wheel will not spin freely, or something is rubbing.',
      'You hit your head. The helmet has done its job once and is finished, and so is riding on today.',
    ],
    steps: [
      {
        text: 'Pick the bike up with your back straight, facing away from it, pushing with your legs. Get help if anyone is around.',
        caution: 'Turn the fuel tap off first on an older bike, and do not leave it lying on its side longer than you must.',
      },
      {
        text: 'Levers. Check the clutch and front brake levers are not snapped, or bent so far you cannot reach them with gloves on.',
      },
      {
        text: 'Brakes. Pull the front lever and press the rear pedal. Both should feel firm and normal.',
      },
      {
        text: 'Lights. Front, rear, brake light and both indicators. A dead indicator is a small thing in daylight and a serious one after dark.',
      },
      {
        text: 'Wheels and chain. Roll the bike forward a few metres and listen. Anything rubbing, grinding or catching means stop.',
      },
      {
        text: 'Look underneath for drips. Petrol, oil or coolant on the road under the bike all mean call rather than ride.',
      },
    ],
    manualSays: 'Nothing here is model-specific, but if it went down hard enough to bend something, only a workshop can tell you whether the frame is still straight.',
  },

  {
    id: 'moto-lights',
    vehicle: 'motorcycle',
    label: 'Lights or electrics have failed',
    blurb: 'No headlight, no brake light, or indicators dead',
    before: [
      'After dark this is the most dangerous fault on this list. In darkness with no street lighting 8.2% of casualties in Mauritius are fatal, against 3.7% in daylight \u2014 and that is for riders who can be seen.',
      'Get off the road. Do not ride on and hope.',
    ],
    stopAndCall: [
      'It is dark and you cannot get a headlight or a rear light back. Do not ride. A lift, a taxi or waiting until morning is the right answer and none of them is an overreaction.',
      'You can smell burning plastic, or anything around the wiring is hot to the touch.',
      'Lights flicker with engine speed, or everything died at once. That is usually charging or a main fuse, and it will strand you again.',
    ],
    steps: [
      {
        text: 'Check the obvious switch first. Many bikes have a separate light switch, and a dip-beam position that can look like a failure.',
      },
      {
        text: 'Fuses. Find the fuse box and look for the blown one. A good fuse has an unbroken metal strip inside; a blown one is parted or blackened.',
        caution: 'Replace it with the same rating. Never a higher one, and never foil or wire. The fuse is what stops a fault becoming a fire.',
      },
      {
        text: 'If a new fuse blows again straight away, stop. Something is shorting and the next one will go too.',
      },
      {
        text: 'Connectors. Look for a plug shaken loose, especially behind the headlight where the loom moves most.',
      },
      {
        text: 'If you have to move the bike after dark with no lights, push it on the kerb side, wear anything reflective you have, and point your phone torch back at the traffic.',
        caution: 'Push it. Do not ride it.',
      },
    ],
    manualSays: 'Which fuse does what, and the bulb types. Neither is worth guessing in the dark.',
  },

  {
    id: 'moto-overheating',
    vehicle: 'motorcycle',
    label: 'Overheating',
    blurb: 'Temperature light or gauge up, or steam',
    before: [
      'Pull off the road and, on a liquid-cooled bike, let it idle for thirty seconds before switching off so the coolant keeps moving.',
      'In slow traffic an air-cooled engine has no airflow, which is the commonest way they overheat here.',
    ],
    stopAndCall: [
      'There is steam, or coolant on the road. Let it cool. Nothing is worth opening while it is hot.',
      'The engine made any mechanical noise before the temperature rose \u2014 rattling, knocking, or a change in pitch.',
      'It has overheated twice on the same ride.',
    ],
    steps: [
      {
        text: 'Switch off and wait. Thirty minutes at least before you touch anything on the engine.',
        caution: 'Never open a radiator cap or coolant reservoir while the engine is hot. The coolant is above boiling and under pressure, and it comes out at your face.',
      },
      {
        text: 'Once it is properly cold, check the coolant level in the reservoir, not the radiator.',
      },
      {
        text: 'Look for the obvious: a radiator packed with mud or leaves, or a cooling fan that never came on while it was hot.',
      },
      {
        text: 'If the level is low and you have the right coolant, top it up. Clean water will get you home in an emergency and must be drained and replaced afterwards.',
        caution: 'Never pour cold water into a hot engine.',
      },
      {
        text: 'Ride gently, keep moving so there is airflow, and watch the gauge the whole way.',
      },
    ],
    manualSays: 'Which coolant your bike takes, and whether it is air- or liquid-cooled at all. An air-cooled engine has no coolant to check, and overheating one means stopping rather than topping up.',
  },

  {
    id: 'moto-out-of-fuel',
    vehicle: 'motorcycle',
    label: 'Out of fuel',
    blurb: 'Ran dry, or it cut out and will not restart',
    before: [
      'Get to the kerb side while you still have momentum. A bike that is running out usually coughs before it stops, and that warning is worth using.',
    ],
    stopAndCall: [
      'You are on the motorway. Do not push a bike along one, and do not walk along one either.',
      'It is dark and you would have to push any distance along a road with traffic.',
    ],
    steps: [
      {
        text: 'On an older carburettor bike, find the fuel tap and turn it to RES. Most keep a litre or two in reserve, usually enough to reach a station.',
        caution: 'Once you are on reserve there is no second chance. Go straight to fuel.',
      },
      {
        text: 'Most fuel-injected bikes have no tap, just a low-fuel light. If that light has been on a while, the tank really is empty.',
      },
      {
        text: 'Check by looking in the tank with the bike upright, not on the side stand. On the stand the fuel pools to one side and the tank looks emptier than it is.',
      },
      {
        text: 'If you must push, push on the kerb side with your helmet on.',
      },
      {
        text: 'After refuelling, a fuel-injected bike may need the ignition cycled a couple of times to prime before it fires.',
      },
    ],
    manualSays: 'Whether your bike has a reserve, and roughly how much is in it.',
  },

  {
    id: 'moto-fire',
    vehicle: 'motorcycle',
    label: 'Smoke, burning or a fuel smell',
    blurb: 'Get off it and get away',
    before: [
      'This one has no repair steps. On a motorcycle the fuel tank sits between your knees and there is nothing between you and it.',
    ],
    stopAndCall: [
      'Always. Stop, get off, and get at least a hundred paces away, upwind.',
      'Fire service 115, and 999 as well if the bike is blocking the road.',
    ],
    steps: [
      { text: 'Leave the bike where it is. Do not try to push it anywhere.' },
      { text: 'Do not go back for anything under the seat or in the panniers.' },
      { text: 'Keep other people back. Tyres burst, and a fuel tank gives no warning.' },
      {
        text: 'If the bike is electric, say so when you call the fire service.',
        caution: 'A battery fire behaves differently and can reignite hours later.',
      },
    ],
  },
]

export const GUIDE_BY_ID = Object.fromEntries(GUIDES.map((g) => [g.id, g]))

/** The guides for one machine. Filtering here rather than at each call site
 *  means a new guide only has to be tagged once to appear in the right
 *  list. */
export function guidesFor(vehicle: Vehicle): Guide[] {
  return GUIDES.filter((g) => g.vehicle === vehicle)
}

/** Warnings that come from the powertrain, which the rider tells us because
 *  no free database reliably says whether a given model is a hybrid. */
export function powertrainWarnings(p: Powertrain, guideId: string): string[] {
  const out: string[] = []

  // Match the motorcycle ids as well as the car ones. Every branch here used
  // to test a car-only id while the screen above the buttons said "this is
  // the one answer that changes what is safe to do" — so an electric scooter
  // got byte-identical guidance to a petrol one, including no warning about
  // the orange cabling. Electric two-wheelers are the fastest-growing thing
  // on these roads, and the voltage does not care which it is bolted to.
  const bike = guideId.startsWith('moto-')
  const is = (...ids: string[]) => ids.includes(guideId)

  if ((p === 'hybrid' || p === 'electric') && is('wont-start', 'moto-wont-start')) {
    out.push(
      bike
        ? 'Orange cables are high voltage. Never touch them, never cut them and never try to jump from them. Many electric bikes also carry a small separate 12 volt battery for the lights, but reaching it means going past the high-voltage side, so check the manual before opening anything.'
        : 'Orange cables are high voltage. Never touch them, never cut them and never jump from them. A hybrid usually has a separate small 12 volt battery that can be jumped, but the terminals and the procedure differ by model, so check the manual first.',
    )
  }

  if (p === 'electric' && is('out-of-fuel', 'moto-out-of-fuel')) {
    out.push(
      bike
        ? 'An electric bike that has run flat needs recovery or a charger. There is nothing you can carry in a can that will get it moving.'
        : 'An electric car that has run flat needs recovery. It cannot be charged at the roadside from a can.',
    )
  }

  if ((p === 'hybrid' || p === 'electric') && is('smoke-or-smell', 'moto-fire')) {
    out.push(
      bike
        ? 'A high-voltage battery fire behaves differently from a petrol one. It can reignite hours later, so stay well back even once it looks out, and tell the fire service on 115 that it is an electric bike when you call.'
        : 'A high-voltage battery fire behaves differently from a petrol fire. It can reignite hours later. Tell the fire service it is a hybrid or electric car when you call.',
    )
  }

  if (p === 'unsure' && is('wont-start', 'moto-wont-start')) {
    out.push(
      bike
        ? 'If you are not sure whether your bike is electric, look for a charging socket or orange cabling. If you see either, do not go near the wiring without the manual.'
        : 'If you are not sure whether your car is a hybrid, look for orange cabling under the bonnet or a charging socket. If you see either, do not jump it without the manual.',
    )
  }

  return out
}

/** What to do while waiting, which changes a lot with where the car stopped. */
export function waitingAdvice(
  where: StoppedWhere,
  isDark: boolean,
  vehicle: Vehicle = 'car',
): string[] {
  const exposed = where === 'motorway' || where === 'main-road'

  if (vehicle === 'motorcycle') {
    // A rider has no doors to get out of, no shell to stand behind, and
    // often no hazard lights at all. None of the car advice transfers.
    const out: string[] = [
      'Push the bike right off the carriageway before anything else. It is lighter than a car and there is no reason to leave it in a lane.',
      'Keep your helmet and gloves on while you are near moving traffic. They are the only protection you have standing up.',
    ]
    if (exposed) {
      out.push(
        'Stand well back from the road, behind a barrier if there is one, and never between the bike and oncoming traffic.',
        'If the bike has hazard lights, put them on. Many do not, so do not count on being seen by them.',
      )
    } else {
      out.push('Put it on the side stand on firm ground. On soft verge it will sink and go over.')
    }
    if (isDark) {
      out.push(
        'After dark, be seen: phone torch on and pointed back at the traffic, and anything reflective you have turned outwards. In darkness with no street lighting 8.2% of casualties here are fatal, against 3.7% in daylight.',
      )
    }
    return out
  }

  const out: string[] = ['Hazard lights on and leave them on.']

  if (exposed) {
    out.push(
      'Everyone out through the kerb-side doors. In Mauritius traffic passes on the driver’s side, so that is the side to keep away from.',
      'Stand behind a barrier or well back from the road, ahead of the car rather than behind it, so a vehicle that hits yours does not hit you too.',
      'Do not stand between your car and oncoming traffic, and do not try a repair on the traffic side.',
    )
  } else {
    out.push('Get the car as far off the carriageway as it will go before doing anything else.')
  }

  if (isDark) {
    out.push(
      'After dark, be seen: interior light on, phone torch on, light colours or anything reflective. On an unlit road a stopped car is almost invisible until the last moment.',
    )
  }
  return out
}
