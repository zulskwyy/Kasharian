/* KasHarian: 12 kata pemulihan PIN. Tanpa internet, tanpa akun.
   Saat PIN dibuat, aplikasi bisa membuat 12 kata acak (dari 1.024 kata Indonesia, 120 bit) yang dicatat pemilik di kertas.
   Yang disimpan di perangkat hanya sidik PBKDF2 dari 12 kata itu, bukan katanya. Lupa PIN: ketik 12 kata, lalu buat PIN baru; data tetap. */
(function (root) {
  'use strict';
  const A = KHApp, { h, S, db, go, frame, card, SCREENS, toast, session } = A;
  const WORDS = (
    'kucing anjing kambing sapi kerbau kuda domba ayam bebek angsa burung elang gagak merpati kenari ' +
    'kakaktua nuri beo jalak camar kasuari ikan hiu paus lumba udang kepiting cumi gurita teripang ' +
    'belut lele gurami nila bandeng kakap tenggiri tongkol sarden layang sotong ubur kura buaya ' +
    'kadal bunglon biawak ular katak kodok cacing siput lebah semut belalang jangkrik capung kumbang ' +
    'nyamuk lalat tawon laba rusa harimau singa macan gajah badak jerapah zebra kancil tapir banteng ' +
    'monyet kera orangutan siamang lutung bekantan beruang musang luwak tupai bajing kelinci marmut ' +
    'hamster tikus kelelawar landak kangguru koala berang pinguin bangau pelikan kuntul kutilang ' +
    'pipit emprit murai kolibri puyuh mangga jeruk apel pisang nanas pepaya jambu semangka melon ' +
    'anggur durian rambutan manggis salak duku langsat sirsak alpukat kelapa sawit kopi teh kakao ' +
    'cengkeh pala kayu jati mahoni beringin bambu rotan pinus cemara palem kamboja melati mawar ' +
    'anggrek teratai tulip dahlia kenanga cempaka bakung asoka puring kaktus lidah talas singkong ' +
    'ubi jagung padi gandum kedelai kacang kentang wortel bayam kangkung sawi kubis tomat terong ' +
    'timun labu cabai bawang jahe kunyit lengkuas serai kemiri ketumbar lada jinten vanili daun akar ' +
    'batang ranting bunga buah biji kulit getah tunas benih rumput lumut jamur paku semak hutan ' +
    'kebun ladang sawah gunung bukit lembah ngarai jurang tebing pantai pasir karang laut samudra ' +
    'selat teluk tanjung pulau atol danau sungai kali anak rawa muara air hujan gerimis badai petir ' +
    'kilat angin topan embun kabut salju awan langit bintang bulan matahari planet komet meteor ' +
    'fajar senja siang malam pagi sore subuh tengah api asap abu bara batu kerikil tanah lumpur debu ' +
    'logam emas perak tembaga besi baja timah seng nikel intan mutiara kristal marmer pualam gua ' +
    'mata sumber terjun ombak gelombang arus pasang surut cahaya bayang pelangi musim kemarau semi ' +
    'gugur dingin hangat panas sejuk udara nasi bubur lontong ketupat mie bihun soto rawon gudeg ' +
    'rendang sate gulai opor semur pepes botok pecel gado lotek rujak tahu tempe oncom perkedel ' +
    'bakwan risol lemper arem klepon onde cenil getuk tiwul lupis serabi martabak pukis kue roti ' +
    'donat bolu nastar sagu cendol dawet susu madu gula garam cuka kecap sambal terasi santan minyak ' +
    'mentega keju telur daging sayur sup krupuk emping keripik dodol wajik wedang jamu sari rumah ' +
    'atap dinding lantai pintu jendela tangga teras dapur kamar ruang halaman pagar gerbang kunci ' +
    'engsel meja kursi bangku lemari rak dipan kasur bantal guling selimut sprei tikar karpet gorden ' +
    'lampu lilin obor kompor panci wajan sendok garpu piring mangkuk gelas cangkir teko baskom ember ' +
    'gayung sapu pel kain handuk sabun sikat cermin jam kalender radio televisi kipas payung tas ' +
    'dompet koper kotak peti keranjang bakul tampah nampan botol toples kaleng tali benang jarum ' +
    'gunting pisau parang cangkul sabit palu obeng gergaji kapak tang kuas cat baju kemeja kaos ' +
    'celana rok sarung jaket sweter kebaya batik topi peci kerudung syal selendang sepatu sandal ' +
    'kaus kacamata cincin gelang kalung anting ikat kepala rambut dahi alis pipi hidung bibir gigi ' +
    'telinga leher bahu lengan siku tangan jari kuku dada perut punggung pinggang paha lutut betis ' +
    'kaki tumit jantung paru hati darah tulang otot napas suara senyum tawa tangis mobil motor ' +
    'sepeda becak bajaj bus truk kereta pesawat kapal perahu sampan rakit jembatan jalan gang lorong ' +
    'stasiun terminal pelabuhan bandara pasar toko warung kios mal bank kantor sekolah kampus masjid ' +
    'gereja pura vihara klenteng apotek puskesmas bengkel pabrik gudang menara tugu monumen museum ' +
    'taman lapangan stadion kolam penjara balai kota desa dusun kelurahan kecamatan negeri bangsa ' +
    'daerah pusat tepi sudut pojok seberang guru dokter perawat petani nelayan pedagang sopir pilot ' +
    'masinis nahkoda tukang montir koki penjahit pelukis penulis penyair pemusik penyanyi penari ' +
    'aktor hakim jaksa polisi tentara satpam kurir juru bidan dukun ulama pendeta biksu pelaut ' +
    'peneliti insinyur arsitek teknisi operator petugas kasir pelayan penjual pembeli tamu teman ' +
    'sahabat tetangga saudara kakak adik ayah ibu nenek kakek paman bibi sepupu cucu bayi remaja ' +
    'dewasa pemuda pemudi lelaki perempuan raja ratu pangeran putri ksatria prajurit pahlawan ' +
    'pemimpin warga makan minum tidur bangun duduk berdiri berjalan berlari melompat berenang ' +
    'terbang menari menyanyi membaca menulis melukis bermain bekerja belajar mengajar bertanya ' +
    'menjawab berbicara mendengar melihat memandang menatap mencium merasa berpikir mengingat ' +
    'melupakan berharap bermimpi tersenyum tertawa menangis berteriak berbisik berdoa memberi ' +
    'menerima mengambil membawa mengirim membuka menutup mengisi menyapu mengepel mencuci menjemur ' +
    'memasak merebus mengaduk memotong membelah menjahit menanam menyiram memanen menebang membangun ' +
    'merawat menjaga mencari menemukan menunggu berangkat pulang tiba singgah mendaki menuruni ' +
    'mendorong menarik melempar menangkap memukul menendang mengayuh mendayung berlayar memancing ' +
    'berburu berdagang menjual membeli menabung berbagi menolong mengantar menyambut merayakan besar ' +
    'kecil panjang pendek tinggi rendah lebar sempit tebal tipis berat ringan cepat lambat kuat ' +
    'lemah keras lunak halus kasar licin kering basah bersih kotor baru lama muda tua indah cantik ' +
    'tampan manis pahit asam asin gurih pedas segar harum busuk tenang ramai sepi riang sedih ' +
    'gembira marah takut berani malu bangga sabar jujur setia rajin malas pintar bodoh bijak ramah ' +
    'santun dermawan hemat boros kaya miskin sehat sakit lapar kenyang haus lelah terang gelap merah ' +
    'biru hijau kuning ungu jingga cokelat putih hitam lurus bengkok bulat runcing datar miring ' +
    'dalam dangkal jauh dekat penuh kosong benar salah mudah sulit aman bahaya cinta kasih sayang ' +
    'rindu harapan impian cita tujuan arti makna rahasia kisah cerita dongeng pantun syair lagu ' +
    'irama nada musik tarian lukisan gambar tulisan buku surat kabar majalah peta jawaban pelajaran ' +
    'ilmu bakat karya hadiah kenangan janji waktu hari minggu tahun abad detik menit kekuatan ' +
    'kejujuran kesabaran kebaikan keadilan kedamaian kebebasan keluarga masa depan sejarah budaya ' +
    'adat tradisi pesta upacara lomba permainan gasing congklak engrang kelereng petak bola catur ' +
    'dadu kartu telepon layar papan tombol kabel baterai listrik mesin roda poros pipa katup pompa ' +
    'kompas jangka penggaris pensil pena kertas tinta lem stempel amplop perangko kamera lensa ' +
    'teropong mikroskop timbangan meteran lonceng peluit seruling gamelan angklung kendang gong ' +
    'suling rebana gitar biola piano terompet harmonika cicak tokek rajawali pelatuk walet punai ' +
    'tekukur perkutut betet kerapu bawal patin mujair teri pari duyung tebu sukun nangka cempedak ' +
    'markisa kesemek delima belimbing kedondong srikaya kersen leci stroberi blewah buncis kecipir ' +
    'pare oyong seledri bakso siomay batagor cilok cireng gorengan opak rempeyek kolak jenang sirup ' +
    'limun sisir alu lesung cobek ulekan irus centong saringan talenan parutan dandang kukusan ' +
    'pelita lentera senter korek topeng wayang dalang keris'
  ).split(' ');
  const INDEX = new Map(WORDS.map((w, i) => [w, i]));
  if (WORDS.length !== 1024 || INDEX.size !== 1024) throw new Error('Daftar kata pemulihan rusak');
  const N = 12;

  const generate = () => { const a = new Uint16Array(N); crypto.getRandomValues(a); return Array.from(a, (v) => WORDS[v & 1023]); };
  const parse = (text) => String(text || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const exists = () => !!(db().recovery && db().recovery.hash);
  async function save(words) { const salt = S.newSalt(); db().recovery = { salt, hash: await S.hashSecret(words.join(' '), salt), at: Date.now() }; S.save(); }
  async function check(words) { const r = db().recovery; return !!(r && words.length === N && words.every((w) => INDEX.has(w)) && (await S.hashSecret(words.join(' '), r.salt)) === r.hash); }

  async function afterPin() {
    if (!db().bio && await A.bioSupported()) return go('bio', null, { replace: true });
    if (!db().onboarded) return go('opening', null, { replace: true });
    A.root('home');
  }

  // ---------- membuat 12 kata ----------
  SCREENS.recoverysetup = (prm) => {
    const fromPin = !!(prm && prm.then === 'afterpin');
    const words = generate();
    const body = h('div', { class: 'stack' });
    const done = (ok) => {
      if (fromPin) {
        if (!ok) KHUI.notice('PIN tidak dapat dipulihkan', h('p', null, 'Tanpa 12 kata pemulihan dan tanpa cadangan, data tidak bisa dibuka lagi bila PIN terlupa. Kamu bisa membuatnya nanti di Lainnya > Keamanan.'), 'warn');
        return afterPin();
      }
      A.back();
    };
    const showWords = () => {
      body.replaceChildren(
        h('p', { class: 'note' }, 'Catat 12 kata ini berurutan di kertas dan simpan di tempat aman. Kalau PIN terlupa, 12 kata ini satu-satunya jalan masuk tanpa internet.'),
        h('div', { class: 'rec-grid', 'data-no-i18n': '' }, words.map((w, i) => h('div', { class: 'rec-word', style: { '--i': i } }, h('small', null, String(i + 1).padStart(2, '0')), h('strong', null, w)))),
        h('p', { class: 'rec-warn' }, 'Jangan difoto, jangan dibagikan. Siapa pun yang punya 12 kata ini bisa membuat PIN baru di perangkatmu.'),
        h('button', { class: 'btn primary block', type: 'button', onclick: quiz }, 'Sudah saya catat'),
        h('button', { class: 'btn ghost block', type: 'button', onclick: () => done(false) }, fromPin ? 'Lewati dulu' : 'Batal'));
    };
    const quiz = () => {
      const picks = [...new Set([0, 1, 2].map((k) => Math.floor(Math.random() * 4) + k * 4))];
      const inputs = picks.map((p) => h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Kata ke-' + (p + 1), placeholder: 'Kata ke-' + (p + 1) }));
      const err = A.errBox();
      body.replaceChildren(
        h('p', { class: 'note' }, 'Pastikan catatanmu benar. Ketik kata yang diminta.'),
        h('div', { class: 'stack' }, inputs.map((inp, i) => h('label', { class: 'field' }, h('span', { class: 'label' }, 'Kata ke-' + (picks[i] + 1)), inp))),
        err,
        h('button', { class: 'btn primary block', type: 'button', onclick: async () => {
          if (inputs.every((inp, i) => inp.value.trim().toLowerCase() === words[picks[i]])) { await save(words); toast('12 kata pemulihan aktif'); return done(true); }
          A.showErr(err, 'Ada kata yang belum cocok. Periksa catatanmu.'); body.classList.remove('rec-shake'); void body.offsetWidth; body.classList.add('rec-shake');
        } }, 'Aktifkan'),
        h('button', { class: 'btn ghost block', type: 'button', onclick: showWords }, 'Lihat 12 kata lagi'));
    };
    showWords();
    return frame({ title: 'Pemulihan PIN', back: !fromPin, children: [card(h('h3', null, '12 kata pemulihan'), body)] });
  };

  // ---------- lupa PIN: ketik 12 kata ----------
  SCREENS.recoveryenter = () => {
    const ta = h('textarea', { class: 'input rec-input', rows: 3, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'aria-label': '12 kata pemulihan', placeholder: 'Ketik 12 kata, pisahkan dengan spasi' });
    const chips = h('div', { class: 'rec-chips', 'aria-live': 'polite', 'data-no-i18n': '' }), err = A.errBox();
    const go1 = h('button', { class: 'btn primary block', type: 'button', disabled: true }, 'Verifikasi');
    const draw = () => {
      const w = parse(ta.value);
      chips.replaceChildren(...w.map((x) => h('span', { class: 'rec-chip' + (INDEX.has(x) ? '' : ' bad') }, x)), h('span', { class: 'rec-count' }, `${Math.min(w.length, 99)} / ${N}`));
      go1.disabled = w.length !== N;
    };
    ta.addEventListener('input', draw);
    session.recTry = session.recTry || { n: 0, until: 0 };
    go1.addEventListener('click', async () => {
      const t = session.recTry, wait = t.until - Date.now();
      if (wait > 0) return A.showErr(err, `Terlalu banyak salah. Coba lagi dalam ${Math.ceil(wait / 1000)} detik.`);
      go1.disabled = true;
      const ok = await check(parse(ta.value));
      if (ok) { t.n = 0; toast('12 kata cocok. Buat PIN baru.'); return go('pinsetup', { flow: 'resetpin' }, { replace: true }); }
      t.n += 1; if (t.n >= 5) { t.until = Date.now() + 30000; t.n = 0; }
      A.showErr(err, 'Belum cocok. Periksa urutan dan ejaan 12 kata.'); draw();
    });
    draw();
    return frame({ title: 'Pulihkan dengan 12 kata', back: true, children: [card(
      h('h3', null, 'Ketik 12 kata pemulihan'),
      h('p', { class: 'note' }, 'Tulis sesuai urutan catatanmu. Setelah cocok, kamu membuat PIN baru dan semua datamu tetap ada.'),
      ta, chips, err, go1)] });
  };

  root.KHRecovery = { WORDS, generate, parse, exists, save, check };
})(typeof self !== 'undefined' ? self : this);
