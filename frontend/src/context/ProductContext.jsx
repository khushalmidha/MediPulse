import { createContext, useContext } from "react";
export const ProductContext = createContext({ kind: "company", basename: "/" });
export const useProduct = () => useContext(ProductContext);
