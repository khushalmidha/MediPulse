const fs = require('fs');
let content = fs.readFileSync('frontend/src/pages/Home.jsx', 'utf8');

// The main hero buttons
const oldHeroBtns = <Link to={isAuth ? '/hospitals' : '/signup/user'} className="inline-flex items-center gap-2 rounded-2xl bg-white dark:bg-slate-950 hover:bg-red-50 transition-all duration-300 px-8 py-4 text-base font-black text-blue-700 shadow-xl hover:-translate-y-0.5">
                {isAuth ? <><Building2 size={20} /> Browse Hospitals</> : <><UserPlus size={20} /> Get Started Free</>}
              </Link>
              <Link to="/smart-booking" className="inline-flex items-center gap-2 rounded-2xl border-2 border-white/30 hover:border-white/60 transition-all duration-300 px-8 py-4 text-base font-bold text-white"><Bot size={20} /> Smart AI Booking</Link>;

const newHeroBtns = <Link to={isAuth ? '/smart-booking' : '/signup/user'} className="inline-flex items-center gap-2 rounded-2xl bg-white dark:bg-slate-950 hover:bg-red-50 transition-all duration-300 px-8 py-4 text-base font-black text-blue-700 shadow-xl hover:-translate-y-0.5">
                {isAuth ? <><Bot size={20} /> Smart AI Booking</> : <><UserPlus size={20} /> Get Started Free</>}
              </Link>
              <Link to="/hospitals" className="inline-flex items-center gap-2 rounded-2xl border-2 border-white/30 hover:border-white/60 transition-all duration-300 px-8 py-4 text-base font-bold text-white"><Building2 size={20} /> Browse Hospitals</Link>;

content = content.replace(oldHeroBtns, newHeroBtns);

// The split section buttons
const oldSplitBtns = <Link to="/hospitals" className="inline-flex items-center gap-2 rounded-2xl bg-red-600 dark:bg-red-700 hover:bg-red-500 dark:bg-red-600 transition-all duration-300 px-8 py-4 text-base font-bold text-white shadow-lg shadow-red-600/30 hover:shadow-red-600/50 hover:-translate-y-0.5">
                    <Building2 size={20} /> Browse Hospitals <ArrowRight size={18} />
                  </Link>
                  <Link to="/smart-booking" className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 dark:bg-slate-950/10 backdrop-blur hover:bg-white/20 dark:bg-slate-950/20 transition-all duration-300 px-8 py-4 text-base font-bold text-white"><Bot size={20} /> Smart AI Booking</Link>;

const newSplitBtns = <Link to="/smart-booking" className="inline-flex items-center gap-2 rounded-2xl bg-red-600 dark:bg-red-700 hover:bg-red-500 dark:bg-red-600 transition-all duration-300 px-8 py-4 text-base font-bold text-white shadow-lg shadow-red-600/30 hover:shadow-red-600/50 hover:-translate-y-0.5">
                    <Bot size={20} /> Smart AI Booking <ArrowRight size={18} />
                  </Link>
                  <Link to="/hospitals" className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 dark:bg-slate-950/10 backdrop-blur hover:bg-white/20 dark:bg-slate-950/20 transition-all duration-300 px-8 py-4 text-base font-bold text-white"><Building2 size={20} /> Browse Hospitals</Link>;

content = content.replace(oldSplitBtns, newSplitBtns);

fs.writeFileSync('frontend/src/pages/Home.jsx', content);
console.log('Fixed Home CTA buttons');
