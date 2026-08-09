import { Heart, Github, Mail, Linkedin } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'
const Footer = () => {
  return (
    <footer className='bg-gray-50 dark:bg-slate-900 mt-auto'>
      <div className='mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8'>
        <div className='footerparts grid grid-cols-1 md:grid-cols-4 gap-8'>
          <div className='fpart1'>
            <div className='logo -ml-10 flex items-center'>
              <div className='w-25 h-20'>
                <DotLottieReact
                  className='w-40 h-20'
                  src='https://lottie.host/da10eca5-8e52-45a4-9f51-1b1271270105/jlZWD8WyC2.lottie'
                  loop
                  autoplay
                />
              </div>
              <span className='ml-2 text-lg font-bold'>MediPulse</span>
            </div>
            <p className='mt-2 text-sm text-gray-600'>
              Empowering differently abled communities through inclusive
              healthcare and support.
            </p>
          </div>
          <div className='fpart2'>
            <h3 className='heading2 '>COMPANY</h3>
            <ul className='mt-4 space-y-4'>
              <li>
                <Link
                  to='/about'
                  className='text-gray-600 hover:text-red-600 dark:text-red-500'>
                  About Us
                </Link>
              </li>
              <li>
                <Link
                  to='/communities'
                  className='text-gray-600 hover:text-red-600 dark:text-red-500'>
                  Communities
                </Link>
              </li>
              <li>
                <Link
                  to='/doctors'
                  className='text-gray-600 hover:text-red-600 dark:text-red-500'>
                  Doctors
                </Link>
              </li>
            </ul>
          </div>
          <div className='fpart3'>
            <h3 className='text-sm font-semibold text-gray-900 dark:text-slate-100 tracking-wider uppercase'>
              Legal
            </h3>
            <ul className='mt-4 space-y-4'>
              <li>
                <Link
                  to={'/privacy'}
                  className='text-gray-600 hover:text-red-600 dark:text-red-500'>
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  to={'/terms'}
                  className='text-gray-600 hover:text-red-600 dark:text-red-500'>
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  to={'/cookiepolicy'}
                  className='text-gray-600 hover:text-red-600 dark:text-red-500'>
                  Cookie Policy
                </Link>
              </li>
            </ul>
          </div>
          <div className='fpart4'>
            <h3 className='text-sm font-semibold text-gray-900 dark:text-slate-100 tracking-wider uppercase'>
              Connect
            </h3>
            <div className='flex space-x-6 mt-4'>
              <a
                href='https://github.com/khushalmidha'
                target='_blank'
                className='text-gray-600 hover:text-red-600 dark:text-red-500'>
                <Github className='h-6 w-6' />
              </a>
              <a
                href='https://www.linkedin.com/in/khushal-midha-260bb3288/'
                target='blank'
                className='text-gray-600 hover:text-red-600 dark:text-red-500'>
                <Linkedin className='h-6 w-6' />
              </a>
              <a
                href='mailto:khushalmidha24@gmail.com'
                className='text-gray-600 hover:text-red-600 dark:text-red-500'>
                <Mail className='h-6 w-6' />
              </a>
            </div>
          </div>
        </div>
        <div className='w-full mt-8 border-t border-gray-200 dark:border-red-900/40 pt-8'>
          <p className='text-center text-sm text-gray-600'>
            © {new Date().getFullYear()} MediPulse. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
