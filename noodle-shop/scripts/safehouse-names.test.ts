// Chat names things the way people talk: "the truck", "the statue in the back", "dave's
// statue", "my car". Nobody knows a #reference. These pin the request grammar's name
// resolution and the move grammar that reads a destination off the end of the sentence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRequest, landmarkFor } from '../src/worlds/safehouse/edits';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { fenceObjects, initializeObject } from '../src/worlds/safehouse/combat';
import { HOUSE_ID } from '../src/shared/safehouseLayout';
import type { SafehouseObject } from '../src/shared/safehouseTypes';

function creation(
  id: string,
  name: string,
  createdBy: string,
  position: { x: number; z: number },
  extra: Partial<SafehouseObject> = {},
): SafehouseObject {
  return initializeObject({
    id,
    revision: 1,
    blueprint: { name, description: name, parts: [] },
    position,
    footprint: { width: 1, depth: 1 },
    createdBy,
    editedBy: createdBy,
    createdAt: 0,
    ...extra,
  });
}
function world(): SafehouseObject[] {
  return [
    ...sceneryObjects(),
    ...fenceObjects(),
    creation('stone-statue-0001', 'Stone statue', 'dave', { x: 2, z: -16.5 }), // back yard, by the rear fence
    creation('garden-statue-001', 'Garden statue', 'erin', { x: -3, z: 2 }), // front yard
    creation('monster-truck-001', 'Road Patrol Monster Truck', 'sami', { x: 40, z: 9 }), // street, east
    creation('gunship-00000001', 'AC-130 Gunship', 'sami', { x: -40, z: -8 }), // west lot
    creation('gorilla-00000001', 'Yard gorilla', 'fay', { x: 8, z: -8 }, { creature: { behaviour: 'rampage', facing: 0, moving: false, path: [], replanMs: 0, cooldownMs: 0 } }),
  ];
}
const byId = (objects: SafehouseObject[], id: string) => objects.find((o) => o.id === id)!;

test('part of a name is enough, and where it is picks between two of the same', () => {
  const objects = world();
  const r = parseRequest('Move the statue in the back to the front', objects);
  assert.equal(r.clarification, undefined, r.clarification);
  assert.equal(r.operation, 'move');
  assert.equal(r.targetId, 'stone-statue-0001');
  assert.equal(r.requestedArea, 'front yard');
  assert.equal(parseRequest('Move the statue in the front yard to the back', objects).targetId, 'garden-statue-001');
  assert.equal(parseRequest('Move the statue in the front yard to the back', objects).requestedArea, 'back yard');
  // Nearest to a named thing works as a qualifier too: the garden statue stands by the house.
  const byHouse = parseRequest('Move the statue by the house to the shop', objects);
  assert.equal(byHouse.targetId, 'garden-statue-001');
  assert.equal(byHouse.requestedArea, 'shop');
  const withCoords = parseRequest('Move the statue in the back to 3,12', objects);
  assert.equal(withCoords.targetId, 'stone-statue-0001');
  assert.deepEqual(withCoords.requestedPosition, { x: 3, z: 12 });
  const behind = parseRequest('Move the statue in the back behind the house', objects);
  assert.equal(behind.targetId, 'stone-statue-0001');
  assert.deepEqual(behind.relativeTo, { objectId: HOUSE_ID, side: 'behind' });
});

test('two statues and no hint is a question that names them, not a demand for a hash', () => {
  const objects = world();
  const r = parseRequest('Move the statue to the front', objects);
  assert.match(r.clarification!, /^Which statue\?/);
  assert.match(r.clarification!, /Stone statue #[\w-]+ \(back yard, by dave\)/);
  assert.match(r.clarification!, /Garden statue #[\w-]+ \(front yard, by erin\)/);
  assert.match(r.clarification!, /the statue in the/);
  assert.equal(r.operation, undefined);
  // A generic name over a whole fence: say where, rather than list 28 sections.
  const fence = parseRequest('Move the fence section to the front', objects);
  assert.match(fence.clarification!, /Which of the \d+ fence sections\? Say where it is/);
});

test('whose it is: "my statue" and "dave\'s statue"', () => {
  const objects = world();
  assert.equal(parseRequest('Paint my statue blue', objects, undefined, 'erin').targetId, 'garden-statue-001');
  assert.equal(parseRequest('Paint my statue blue', objects, undefined, 'erin').quick?.kind, 'recolor');
  assert.equal(parseRequest("Make dave's statue 20% taller", objects).targetId, 'stone-statue-0001');
  assert.match(parseRequest("Paint gus's statue red", objects).clarification!, /Nothing here was built by gus/);
  assert.match(parseRequest('Paint my truck red', objects, undefined, 'erin').clarification!, /can't find a truck built by you/);
  // Rook's own things are names, not ownership.
  assert.equal(parseRequest("Turn Rook's car around", objects).angle, Math.PI);
});

test('quick edits, turns and repairs by a short name', () => {
  const objects = world();
  assert.equal(parseRequest('Paint the gunship red', objects).targetId, 'gunship-00000001');
  assert.equal(parseRequest('Paint the gunship red', objects).quick?.color, '#b65b50');
  assert.equal(parseRequest('Make the truck 20% bigger', objects).targetId, 'monster-truck-001');
  assert.equal(parseRequest('Turn the monster truck around', objects).targetId, 'monster-truck-001');
  assert.equal(parseRequest('Rotate the ferris wheel 90 degrees', objects).clarification !== undefined, true);
  // "the roof of the truck" is a part: a redesign of the truck, no recolor.
  const roof = parseRequest('Paint the roof of the truck red', objects);
  assert.equal(roof.targetId, 'monster-truck-001');
  assert.equal(roof.quick, undefined);
  // A repair of a generic name takes the worst one.
  const garage = byId(objects, 'scenery-garage');
  const fences = objects.filter((o) => o.id.startsWith('fence-'));
  fences[3].health = 100;
  fences[7].health = 40;
  fences[7].damageRevision = 2;
  assert.equal(parseRequest('Repair the fence', objects).targetId, fences[7].id);
  assert.equal(parseRequest('Fix the fence', objects).operation, 'repair');
  fences[2].destroyedAt = 5;
  assert.equal(parseRequest('Rebuild the fence', objects).targetId, fences[2].id);
  assert.equal(parseRequest('Rebuild the fence', objects).operation, 'rebuild');
  garage.health = 10;
  assert.equal(parseRequest('Repair the garage', objects).targetId, 'scenery-garage');
});

test('free text: a part-name mention edits the thing; describing a new thing does not', () => {
  const objects = world();
  const chimney = parseRequest('Add a chimney to the truck', objects);
  assert.equal(chimney.targetId, 'monster-truck-001');
  assert.equal(chimney.quick, undefined);
  assert.equal(parseRequest('Make the truck bigger and meaner', objects).targetId, 'monster-truck-001');
  for (const text of ['Build a dog that fights the gorilla', 'Build a statue of the gunship', 'Build a bench in the garden']) {
    const r = parseRequest(text, objects);
    assert.equal(r.targetId, undefined, text);
    assert.equal(r.clarification, undefined, text);
  }
  // Loose placement words are placement: "near the gunship" builds next to it.
  const near = parseRequest('Build a turret near the gunship', objects);
  assert.equal(near.targetId, undefined);
  assert.deepEqual(near.relativeTo, { objectId: 'gunship-00000001', side: 'next to' });
  assert.deepEqual(parseRequest('Build a lamp by the house', objects).relativeTo, { objectId: HOUSE_ID, side: 'next to' });
  assert.equal(parseRequest('Put a lamp next to the house', objects).operation, undefined);
  assert.equal(parseRequest('Put a lamp next to the house', objects).relativeTo?.objectId, HOUSE_ID);
  assert.equal(parseRequest('Put the truck next to the house', objects).operation, 'move');
});

test('destinations chat actually says, and honest misses', () => {
  const objects = world();
  assert.equal(landmarkFor('the front'), 'front yard');
  assert.equal(landmarkFor('out back'), 'back yard');
  assert.equal(landmarkFor('the garage'), 'by the garage');
  assert.equal(landmarkFor('over the road'), 'across the street');
  assert.equal(landmarkFor('the moon'), undefined);
  assert.equal(parseRequest('Move the truck to the garage', objects).requestedArea, 'by the garage');
  assert.equal(parseRequest('Move the truck over to the park', objects).requestedArea, 'park');
  assert.deepEqual(parseRequest('Move the truck to the house', objects).relativeTo, { objectId: HOUSE_ID, side: 'next to' });
  assert.equal(parseRequest('Build a bench at the back', objects).requestedArea, 'back yard');
  assert.equal(parseRequest('Build a truck with a big front bumper', objects).requestedArea, undefined);
  assert.match(parseRequest('Move the truck to the moon', objects).clarification!, /^Where to\?/);
  assert.match(parseRequest('Move the truck', objects).clarification!, /^Where to\?/);
  assert.match(parseRequest('Move the spaceship to the front', objects).clarification!, /can't find “the spaceship”/);
  assert.match(parseRequest('Move the red statue to the front', objects).clarification!, /Did you mean Stone statue/);
  assert.match(parseRequest('Move the statue in the park to the front', objects).clarification!, /None of these is in the park/);
});
