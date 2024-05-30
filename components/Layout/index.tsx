import React, { PropsWithChildren } from "react"

import Header from "@/components/Layout/Header"
import Footer from "@/components/Layout/Footer"
import PageBackground from "@/components/PageBackground"

const Layout: React.FC<PropsWithChildren> = ({ children }) => {
  // PREFETCH: Prefetch action could be done similarly to the prefetch action
  //           in _app.ts within the pages Router.
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex flex-1">
        <div className="flex flex-1 w-full max-w-5xl bg-gray-50">
          {children}
        </div>
        <PageBackground />
      </main>
      <Footer />
    </div>
  )
}

export default Layout
