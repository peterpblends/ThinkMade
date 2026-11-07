import { VOICE_CATALOG } from './settings.ts';

/**
 * Common first names whose gender is clear, so a host the listener (or a model) named without saying their
 * gender is still given a voice that matches the name. Every voice's own name counts too.
 */
const FEMALE = `abigail ada adriana aisha alejandra alexandra alice alicia alison amanda amber amelia amy ana andrea angela anika anna
annie ariana audrey ava barbara beatriz bella beth bethany bianca brenda brianna brooke camila camille carla carmen caroline
catherine charlotte chloe christina claire clara daniela deborah diana dora eleanor elena elizabeth ella ellie emily emma
erin esther eva evelyn fatima fiona florence frances gabriela grace hailey hannah harriet heather helen holly isabel isabella
isabelle ivy jacqueline jane janet jasmine jennifer jessica joanna josephine julia julie karen kate katherine kathleen katie
kayla kelly kimberly laura lauren leah lily linda lisa lucia lucy luna lydia madeline madison maggie margaret maria mariana
marie martha mary maya megan melissa mia michelle mila molly monica nadia naomi natalie nicole nina nora olivia paige paula
penelope priya rachel rebecca rose ruby ruth sabrina samantha sara sarah scarlett sofia sophia sophie stella stephanie susan
tara teresa valentina vanessa victoria violet zara zoe`.split(/\s+/);
const MALE = `aaron adam adrian ahmed alan albert alejandro alex alexander andrew anthony arjun arthur ben benjamin brandon brian
caleb carl carlos charles chris christian christopher daniel david diego dominic dylan edward edwin elijah eric ethan felix
frank gabriel george gregory harry henry hugo ian isaac jack jacob jake james jason javier jeffrey jeremy jesse john jonathan
jordan jose joseph joshua juan julian justin kevin kyle leo leon liam logan lucas luis luke marcus mark martin mason matthew
max michael miguel mohammed nathan nicholas noah oliver omar oscar owen patrick paul peter philip rafael raj ravi richard
robert rohan ryan samuel sean sebastian simon stephen steven thomas timothy tom tyler victor vincent walter william zachary`.split(/\s+/);

const GENDER = new Map<string, 'female' | 'male'>([
  ...FEMALE.map((n) => [n, 'female'] as const),
  ...MALE.map((n) => [n, 'male'] as const),
  ...VOICE_CATALOG.map((v) => [v.name.toLowerCase(), v.gender] as const),
]);
// Names used for both are left to the voice.
for (const n of ['jordan', 'alex', 'sam', 'taylor', 'morgan', 'casey', 'riley', 'jamie', 'robin', 'avery', 'quinn']) GENDER.delete(n);

/** The gender a first name usually has, or null when it isn't clear. */
export function genderOfName(name: string | null | undefined): 'female' | 'male' | null {
  const first = (name ?? '').trim().split(/[\s-]+/)[0]?.toLowerCase().replace(/[^a-zà-ÿ']/g, '') ?? '';
  return GENDER.get(first) ?? null;
}
