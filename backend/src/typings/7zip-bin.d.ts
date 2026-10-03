// O pacote 7zip-bin não fornece tipos próprios.
declare module "7zip-bin" {
  const sevenBin: {
    path7za: string;
    path7x?: string;
    path7zip?: string;
  };
  export default sevenBin;
}
