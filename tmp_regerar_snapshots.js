const jwt = require('jsonwebtoken');

const JWT_SECRET = '549ad4c940d5be0e6cf63887ba66826e62c0544e527af6e9786bf45b2d6a1bdbef10faa63e837d1ff96558f919cbfaea2d210bae14d676660d9fee70a44aabce';
const BASE = 'http://localhost:3000/api';
const ADMIN = { sub: 1, email: 'rubensjr.me@gmail.com', nome: 'Rubens Junior' };

const TURMAS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,62,63,64,65,66,86,87,95,115,116,149,150,151,152,153,154,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,195,199];

async function main() {
  const token = jwt.sign(ADMIN, JWT_SECRET, { expiresIn: '2h' });
  let ok = 0, fail = 0;
  const erros = [];
  for (const id of TURMAS) {
    try {
      const res = await fetch(`${BASE}/turmas/${id}/snapshot/regerar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        ok++;
        process.stdout.write(`.`);
      } else {
        fail++;
        const txt = await res.text();
        erros.push(`turma ${id}: HTTP ${res.status} ${txt.slice(0,120)}`);
        process.stdout.write(`x`);
      }
    } catch (e) {
      fail++;
      erros.push(`turma ${id}: ${e.message}`);
      process.stdout.write(`x`);
    }
  }
  console.log(`\n\nRegeração concluída. Sucesso: ${ok} | Falhas: ${fail}`);
  if (erros.length) {
    console.log('--- Erros ---');
    erros.forEach(e => console.log(e));
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
